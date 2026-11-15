const express = require('express');
const db = require('../database');
const ecpay = require('../services/ecpay');

const router = express.Router();

/**
 * @openapi
 * /api/payment/ecpay/result:
 *   post:
 *     summary: 綠界 OrderResultURL（瀏覽器前景導回）
 *     tags: [Payment]
 *     description: 不信任 body 內容，驗證 CheckMacValue 後主動呼叫 QueryTradeInfo 確認付款結果，再 302 導回訂單頁
 *     responses:
 *       302:
 *         description: 導向 /orders/{id}?payment=success|failed|pending
 */
router.post('/ecpay/result', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.MerchantTradeNo || !ecpay.verifyCheckMacValue(body)) {
      return res.redirect('/orders');
    }
    const order = db.prepare('SELECT * FROM orders WHERE merchant_trade_no = ?').get(body.MerchantTradeNo);
    if (!order) return res.redirect('/orders');

    let outcome = 'pending';
    try {
      ({ outcome } = await ecpay.syncOrderPayment(order));
    } catch (e) {
      // 查詢失敗時維持 pending，使用者可在訂單頁手動查詢
    }
    const q = outcome === 'paid' ? 'success' : outcome;
    res.redirect(`/orders/${order.id}?payment=${q}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
