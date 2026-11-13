// CDP 的取消通知可能晚于 fulfillRequest 的失败响应。
async function isCancelledInterception(error, isCancelled, settle = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    if (!/^Invalid InterceptionId\.?$/.test(error.message)) return false;
    if (isCancelled()) return true;
    await settle(150);
    return isCancelled();
}
module.exports = { isCancelledInterception };
