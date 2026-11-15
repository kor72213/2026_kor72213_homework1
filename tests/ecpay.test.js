const { app, request, registerUser } = require('./setup');
const ecpay = require('../src/services/ecpay');
const vectors = require('../.claude/skills/ecpay/test-vectors/checkmacvalue.json');

describe('ECPay CheckMacValue', () => {
  it('matches official SHA256 test vector', () => {
    const v = vectors.vectors.find((x) => x.method === 'SHA256');
    expect(ecpay.generateCheckMacValue(v.params, v.hashKey, v.hashIV)).toBe(v.expected);
  });
});

describe('ECPay payment flow', () => {
  let token, orderId, tradeNo;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ token } = await registerUser());
    const products = await request(app).get('/api/products');
    await request(app).post('/api/cart').set(auth()).send({ productId: products.body.data.products[0].id, quantity: 1 });
    const order = await request(app).post('/api/orders').set(auth())
      .send({ recipientName: 'A', recipientEmail: 'a@example.com', recipientAddress: 'Taipei' });
    orderId = order.body.data.id;
  });

  it('returns signed checkout form fields', async () => {
    const res = await request(app).post(`/api/orders/${orderId}/ecpay/checkout`).set(auth());
    expect(res.status).toBe(200);
    const { action, fields } = res.body.data;
    expect(action).toContain('/Cashier/AioCheckOut/V5');
    expect(fields.ChoosePayment).toBe('Credit');
    expect(fields.MerchantTradeNo).toMatch(/^[A-Za-z0-9]{1,20}$/);
    expect(ecpay.verifyCheckMacValue(fields)).toBe(true);
    tradeNo = fields.MerchantTradeNo;
  });

  it('rejects checkout for another user', async () => {
    const other = await registerUser();
    const res = await request(app).post(`/api/orders/${orderId}/ecpay/checkout`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });

  it('keeps pending when ECPay reports unpaid', async () => {
    vi.spyOn(ecpay, 'queryTradeInfo').mockResolvedValue({
      MerchantID: ecpay.getConfig().merchantId, MerchantTradeNo: tradeNo, TradeStatus: '0'
    });
    const res = await request(app).post(`/api/orders/${orderId}/ecpay/query`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');
  });

  it('marks paid via OrderResultURL after verified query, idempotently', async () => {
    const order = await request(app).get(`/api/orders/${orderId}`).set(auth());
    vi.spyOn(ecpay, 'queryTradeInfo').mockResolvedValue({
      MerchantID: ecpay.getConfig().merchantId, MerchantTradeNo: tradeNo, TradeStatus: '1',
      TradeAmt: String(order.body.data.total_amount), TradeNo: '2611150000001', PaymentType: 'Credit_CreditCard'
    });
    const cfg = ecpay.getConfig();
    const body = { MerchantID: cfg.merchantId, MerchantTradeNo: tradeNo, RtnCode: '1' };
    body.CheckMacValue = ecpay.generateCheckMacValue(body, cfg.hashKey, cfg.hashIv);
    const res = await request(app).post('/api/payment/ecpay/result').type('form').send(body);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/orders/${orderId}?payment=success`);
    const again = await request(app).post(`/api/orders/${orderId}/ecpay/query`).set(auth());
    expect(again.body.data.status).toBe('paid');
    expect(again.body.data.ecpay_trade_no).toBe('2611150000001');
  });

  it('rejects forged OrderResultURL', async () => {
    const res = await request(app).post('/api/payment/ecpay/result').type('form')
      .send({ MerchantTradeNo: tradeNo, CheckMacValue: 'BAD' });
    expect(res.headers.location).toBe('/orders');
  });
});
