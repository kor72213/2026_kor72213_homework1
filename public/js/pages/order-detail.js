const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const el = document.getElementById('app');
    const orderId = el.dataset.orderId;
    const paymentResult = ref(el.dataset.paymentResult || null);

    const order = ref(null);
    const loading = ref(true);
    const paying = ref(false);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    const paymentMessages = {
      success: { text: '付款成功！感謝您的購買。', cls: 'bg-sage/10 text-sage border border-sage/20' },
      failed: { text: '付款失敗，請重試。', cls: 'bg-red-50 text-red-600 border border-red-100' },
      pending: { text: '付款結果確認中，請稍後按「查詢付款結果」。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
      cancel: { text: '付款已取消。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
    };

    async function simulatePay(action) {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/pay', {
          method: 'PATCH',
          body: JSON.stringify({ action })
        });
        order.value = res.data;
        paymentResult.value = action === 'success' ? 'success' : 'failed';
      } catch (e) {
        Notification.show('付款處理失敗', 'error');
      } finally {
        paying.value = false;
      }
    }

    // 取得綠界表單參數後，以動態 form POST 導向綠界付款頁（不可用 iframe）
    async function handleEcpayPay() {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay/checkout', { method: 'POST' });
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = res.data.action;
        Object.keys(res.data.fields).forEach(function (k) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = k;
          input.value = res.data.fields[k];
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      } catch (e) {
        Notification.show('無法前往綠界付款', 'error');
        paying.value = false;
      }
    }

    // 本地端收不到綠界通知，主動查詢付款結果
    async function handleEcpayQuery(silent) {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay/query', { method: 'POST' });
        order.value = res.data;
        if (res.data.status === 'paid') paymentResult.value = 'success';
        else if (res.data.status === 'failed') paymentResult.value = 'failed';
        else if (silent !== true) Notification.show(res.message, 'info');
      } catch (e) {
        if (silent !== true) {
          Notification.show(e && e.data && e.data.message ? e.data.message : '查詢付款結果失敗', 'error');
        }
      } finally {
        paying.value = false;
      }
    }

    function handlePaySuccess() { simulatePay('success'); }
    function handlePayFail() { simulatePay('fail'); }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/orders/' + orderId);
        order.value = res.data;
      } catch (e) {
        Notification.show('載入訂單失敗', 'error');
      } finally {
        loading.value = false;
      }
      // 從綠界導回但結果尚未確認時，自動再查一次
      if (paymentResult.value === 'pending' && order.value && order.value.status === 'pending') {
        handleEcpayQuery(true);
      }
    });

    return { order, loading, paying, paymentResult, statusMap, paymentMessages, handlePaySuccess, handlePayFail, handleEcpayPay, handleEcpayQuery: function () { return handleEcpayQuery(); } };
  }
}).mount('#app');
