(function () {
  var isExtErr = function (err, fn) {
    var str = (fn || "") + " " + ((err && err.stack) || "") + " " + ((err && err.message) || "");
    return (
      str.indexOf("chrome-extension://") !== -1 ||
      str.indexOf("moz-extension://") !== -1 ||
      str.indexOf("onMessage") !== -1 ||
      str.indexOf("Extension context invalidated") !== -1
    );
  };
  window.addEventListener(
    "error",
    function (e) {
      if (isExtErr(e.error, e.filename)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true
  );
  window.addEventListener(
    "unhandledrejection",
    function (e) {
      if (isExtErr(e.reason, "")) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true
  );
})();
