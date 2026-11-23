// Cấu hình kết nối máy trung gian (Supabase) — dùng chung cho app máy tính và app điện thoại.
// Hai giá trị này là CÔNG KHAI (được phép nằm trong app). Quyền truy cập do RLS + ghép máy quyết định.
// TUYỆT ĐỐI không để secret / service_role key ở đây.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DBRemoteConfig = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    url: 'https://vusccvbmntgfjijsypxa.supabase.co',
    publishableKey: 'sb_publishable_s26-CbpUHy0zNatRq_YFvA_1Dv1nF-R',
    bucket: 'uploads',
    mobileUrl: 'https://taoquavip456.github.io/dangbai-mobile/', // app điện thoại (GitHub Pages)
    protocol: 1 // phiên bản giao thức lệnh (tăng khi đổi cấu trúc lệnh)
  };
});
