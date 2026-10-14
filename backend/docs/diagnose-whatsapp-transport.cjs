// Transport probe only: no auth, message payloads or session files.
const WebSocket = require('ws');
const allowed = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EACCES', 'EPERM']);
const socket = new WebSocket('wss://web.whatsapp.com/ws/chat', { origin: 'https://web.whatsapp.com', handshakeTimeout: 10000 });
let finished = false;
const timer = setTimeout(() => finish({ result: 'timeout' }), 12000);
function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.log(JSON.stringify({ ...result, customCaConfigured: !!process.env.NODE_EXTRA_CA_CERTS, insecureTls: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' }));
  socket.terminate();
}
socket.on('open', () => finish({ result: 'websocket_open' }));
socket.on('error', error => finish({ result: 'websocket_error', code: allowed.has(error.code) ? error.code : 'other', unexpectedHttpResponse: String(error.message).startsWith('Unexpected server response:') }));
socket.on('unexpected-response', (_request, response) => { response.resume(); finish({ result: 'http_rejection', status: response.statusCode }); });
