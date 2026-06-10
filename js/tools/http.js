const axios = require('axios');

function initHttpTool() {
  document.getElementById('send-request').addEventListener('click', async () => {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value;
    const headers = document.getElementById('http-headers').value;
    const body = document.getElementById('http-body').value;

    try {
      const config = {
        method,
        url,
        headers: headers ? JSON.parse(headers) : {}
      };

      if (method !== 'GET' && method !== 'DELETE') {
        config.data = body ? JSON.parse(body) : {};
      }

      const response = await axios(config);
      document.getElementById('http-response').value = JSON.stringify(response.data, null, 2);
      document.getElementById('http-status').value = response.status + ' ' + response.statusText;
    } catch (e) {
      document.getElementById('http-response').value = '错误: ' + (e.response?.data || e.message);
      document.getElementById('http-status').value = e.response?.status || 'Error';
    }
  });
}

module.exports = { initHttpTool };
