const crypto = require('crypto');
const db = require('../database');

// Source: 綠界 AIO 規格 https://developers.ecpay.com.tw/2862.md (AioCheckOut/V5)
//         QueryTradeInfo https://developers.ecpay.com.tw/2890.md
// CheckMacValue 實作：ecpay skill guides/13-checkmacvalue.md (Node.js)

function getConfig() {
  const staging = (process.env.ECPAY_ENV || 'staging') !== 'production';
  return {
    merchantId: process.env.ECPAY_MERCHANT_ID || '3002607',
    hashKey: process.env.ECPAY_HASH_KEY || 'pwFHCqoQZGmho4w6',
    hashIv: process.env.ECPAY_HASH_IV || 'EkRm7iFT261dpevs',
    host: staging ? 'https://payment-stage.ecpay.com.tw' : 'https://payment.ecpay.com.tw',
    baseUrl: (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, ''),
  };
}

function ecpayUrlEncode(source) {
  let encoded = encodeURIComponent(source).replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27');
  encoded = encoded.toLowerCase();
  const replacements = { '%2d': '-', '%5f': '_', '%2e': '.', '%21': '!', '%2a': '*', '%28': '(', '%29': ')' };
  for (const [from, to] of Object.entries(replacements)) {
    encoded = encoded.split(from).join(to);
  }
  return encoded;
}

function generateCheckMacValue(params, hashKey, hashIv) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const paramStr = keys.map((k) => `${k}=${params[k]}`).join('&');
  const encoded = ecpayUrlEncode(`HashKey=${hashKey}&${paramStr}&HashIV=${hashIv}`);
  return crypto.createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase();
}

function verifyCheckMacValue(params) {
  const { hashKey, hashIv } = getConfig();
  const a = Buffer.from(String(params.CheckMacValue || ''));
  const b = Buffer.from(generateCheckMacValue(params, hashKey, hashIv));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// MerchantDate 需為 UTC+8，格式 yyyy/MM/dd HH:mm:ss
function toTaipeiDateString(date = new Date()) {
  const t = new Date(date.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

// ItemName 上限 400 字元，並移除 # 以外可能造成 WAF/簽章問題的字元
function buildItemName(items) {
  const name = items
    .map((i) => `${i.product_name} x${i.quantity}`)
    .join('#')
    .replace(/[<>&%\x00-\x1F]/g, '');
  return name.length > 200 ? name.slice(0, 200) : name;
}

// 英數、<= 20 字元；每次付款嘗試皆重新產生（綠界不允許重複使用）
function generateMerchantTradeNo() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return ('FL' + Date.now().toString(36).toUpperCase() + rand).slice(0, 20);
}

function buildCheckoutParams(order, items, merchantTradeNo) {
  const cfg = getConfig();
  const fields = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: toTaipeiDateString(),
    PaymentType: 'aio',
    TotalAmount: String(order.total_amount),
    TradeDesc: 'FlowerLife',
    ItemName: buildItemName(items),
    // 本地端收不到 Server Notify，但 ReturnURL 為必填；實際結果以主動查詢為準
    ReturnURL: `${cfg.baseUrl}/api/payment/ecpay/notify`,
    OrderResultURL: `${cfg.baseUrl}/api/payment/ecpay/result`,
    ChoosePayment: 'Credit',
    EncryptType: '1',
  };
  fields.CheckMacValue = generateCheckMacValue(fields, cfg.hashKey, cfg.hashIv);
  return { action: `${cfg.host}/Cashier/AioCheckOut/V5`, fields };
}

// 主動查詢綠界訂單（QueryTradeInfo/V5）。TimeStamp 3 分鐘有效，每次重新取得。
async function queryTradeInfo(merchantTradeNo) {
  const cfg = getConfig();
  const params = {
    MerchantID: cfg.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  };
  params.CheckMacValue = generateCheckMacValue(params, cfg.hashKey, cfg.hashIv);

  const res = await fetch(`${cfg.host}/Cashier/QueryTradeInfo/V5`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const err = new Error(`ECPay QueryTradeInfo HTTP ${res.status}`);
    err.status = 502;
    throw err;
  }
  const result = Object.fromEntries(new URLSearchParams(await res.text()));
  if (!verifyCheckMacValue(result)) {
    const err = new Error('ECPay QueryTradeInfo CheckMacValue 驗證失敗');
    err.status = 502;
    throw err;
  }
  return result;
}

/**
 * 以綠界查詢結果同步訂單狀態（冪等）。回傳 { order, outcome }，
 * outcome: 'paid' | 'failed' | 'pending'
 */
async function syncOrderPayment(order) {
  if (order.status === 'paid') return { order, outcome: 'paid' };
  if (order.status === 'failed') return { order, outcome: 'failed' };

  // 透過 module.exports 呼叫，測試才能以 vi.spyOn 攔截
  const info = await module.exports.queryTradeInfo(order.merchant_trade_no);
  const cfg = getConfig();
  if (info.MerchantID !== cfg.merchantId || info.MerchantTradeNo !== order.merchant_trade_no) {
    return { order, outcome: 'pending' };
  }

  let outcome = 'pending';
  if (info.TradeStatus === '1') {
    if (Number(info.TradeAmt) !== order.total_amount) return { order, outcome: 'pending' };
    db.prepare(
      "UPDATE orders SET status = 'paid', ecpay_trade_no = ?, payment_type = ?, paid_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).run(info.TradeNo || null, info.PaymentType || null, order.id);
    outcome = 'paid';
  } else if (info.TradeStatus === '10200095') {
    db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(order.id);
    outcome = 'failed';
  }
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  return { order: updated, outcome };
}

module.exports = {
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  generateMerchantTradeNo,
  buildCheckoutParams,
  queryTradeInfo,
  syncOrderPayment,
  getConfig,
};
