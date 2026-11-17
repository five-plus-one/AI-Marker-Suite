// 韬普教育：原生单题评阅页，给分点与题块图片位于同源 main_frame。
const TAOWEI_SELECTORS = {
    FRAME: '#main_frame',
    ROWS: '#dfdxx .dfddiv',
    INPUT: 'input.dfdinput',
    LABEL: '.dfdspan',
    IMAGES: '#imgdiv img[id^="mainimg_"]',
    PAPER: '#copyvalue',
    SUBMIT: '#tjfsbtn',
    CONFIRM: '#dfqr_div',
    CONFIRM_TEXT: '#qrfs',
    CONFIRM_BUTTON: '#dfqr_div button.btn-primary[onclick="tjajax()"]',
    BLOCKERS: '.layui-layer-shade, .layui-layer-dialog, .layui-layer-loading, .layui-layer-page, .layui-layer-iframe',
};
