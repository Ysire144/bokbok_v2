/* 귤복복 살인사건 : 서비스 워커
   목적: 느린 회선 / 오래된 폰에서도 그림을 한 번만 받고, 그 뒤로는 네트워크 없이 바로 열리게 하기.
   - images/ 아래 그림: 저장소(Cache Storage)에 있으면 그걸 바로 줌 (네트워크 안 감). 없으면 받아서 저장하고 줌.
     같은 그림을 동시에 두 번 받지 않게 진행 중인 요청은 하나로 합침.
   - 게임 페이지(index.html): 네트워크를 먼저 시도하되, 3초 안에 안 오면 저장해 둔 것을 보여줌 (느린 회선에서 하얀 화면 방지).
   - 그림이 바뀌었는지는 페이지가 'revalidate' 메시지를 보내면 뒤에서 하나씩 물어봄 (ETag 로 물어보니 안 바뀌었으면 거의 0바이트).
   - 문제가 생기면 주소 뒤에 ?nosw 를 붙여서 열면 서비스 워커와 저장소를 지우고 평소처럼 동작함 (스크립트가 처리).
   이 파일을 고치면 아래 SW_VERSION 을 올려. (그림 파일이 바뀌는 건 올리지 않아도 돼) */
var SW_VERSION = 'v1';
var IMG_CACHE = 'bokbok-img-' + SW_VERSION;
var HTML_CACHE = 'bokbok-html-' + SW_VERSION;
var NET_WAIT_MS = 3000;             // 저장해 둔 게임 페이지가 있을 때, 네트워크를 이만큼만 기다리고 저장본을 보여줌

var inflight = {};                  // 그림 주소 -> 받는 중인 약속 (같은 그림 중복 요청 방지)

/* 설치할 때 지금 열려 있는 게임 페이지를 저장해 둠 (처음 접속 때는 서비스 워커가 아직 없어서 페이지를 못 저장했으니까).
   방금 받은 페이지라 보통은 브라우저 캐시에서 나와서 인터넷을 다시 쓰지 않아. */
function savePageNow() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    var url = new URL(cs.length ? cs[0].url : self.registration.scope);
    url.search = '';
    url.hash = '';
    return fetch(url.href).then(function (resp) {
      if (resp && resp.status === 200) return caches.open(HTML_CACHE).then(function (c) { return c.put(pageKey(), resp); });
    });
  }).catch(function () {});
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(savePageNow());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return (k.indexOf('bokbok-img-') === 0 && k !== IMG_CACHE) || (k.indexOf('bokbok-html-') === 0 && k !== HTML_CACHE);
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function plainKey(u) {              // 주소에서 ?뒤와 #뒤를 뗀 것 (재시도용 ?r=1 같은 꼬리표를 같은 그림으로 취급)
  var x = new URL(u);
  x.search = '';
  x.hash = '';
  return x.href;
}

function storeImage(cache, key) {
  if (inflight[key]) return inflight[key];
  var p = fetch(key, { cache: 'no-cache', credentials: 'same-origin' }).then(function (resp) {
    if (resp && resp.status === 200) {
      return cache.put(key, resp.clone()).then(function () { return resp; }, function () { return resp; });
    }
    return resp;
  });
  inflight[key] = p;
  var clear = function () { delete inflight[key]; };
  p.then(clear, clear);
  return p;
}

function imageResponse(req) {
  var key = plainKey(req.url);
  return caches.open(IMG_CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return hit;
      if (inflight[key]) {          // 누가 이미 받는 중이면 끝날 때까지 기다렸다가 저장된 걸 줌
        return inflight[key].then(function () {
          return cache.match(key).then(function (h2) { return h2 || fetch(key); });
        });
      }
      return storeImage(cache, key);
    });
  });
}

function pageKey() { return new URL('index.html', self.registration.scope).href; }

function pageResponse(e) {
  var key = pageKey();
  var net = fetch(e.request).then(function (resp) {
    if (resp && resp.status === 200) {
      var copy = resp.clone();
      caches.open(HTML_CACHE).then(function (c) { return c.put(key, copy); }).catch(function () {});
    }
    return resp;
  });
  e.waitUntil(net.catch(function () {}));          // 저장본을 먼저 보여준 뒤에도 뒤에서 새 걸 받아 저장해 둠
  return caches.open(HTML_CACHE).then(function (c) { return c.match(key); }).then(function (hit) {
    if (!hit) return net;
    return new Promise(function (resolve) {
      var done = false;
      function once(r) { if (!done) { done = true; resolve(r); } }
      net.then(once, function () { once(hit); });
      setTimeout(function () { once(hit); }, NET_WAIT_MS);
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.search.indexOf('nosw') >= 0) return;       // ?nosw 로 연 페이지는 그냥 네트워크로
  if (req.headers.has('range')) return;
  if (req.headers.get('x-dl')) return;              // 페이지가 직접 받는 중인 요청 (진행률을 재고 직접 저장하니까 그대로 통과)
  var scope = new URL(self.registration.scope);
  if (u.pathname.indexOf(scope.pathname + 'images/') === 0) { e.respondWith(imageResponse(req)); return; }
  if (req.mode === 'navigate' && (u.pathname === scope.pathname || u.pathname === scope.pathname + 'index.html')) {
    e.respondWith(pageResponse(e));
  }
});

/* 페이지가 보내는 메시지
   { type: 'revalidate' }  저장된 그림이 서버에서 바뀌었는지 하나씩 물어보고, 바뀐 것만 새로 받아 저장 */
function revalidateAll() {
  return caches.open(IMG_CACHE).then(function (cache) {
    return cache.keys().then(function (reqs) {
      var i = 0;
      function next() {
        if (i >= reqs.length) return Promise.resolve();
        var r = reqs[i++];
        return cache.match(r).then(function (hit) {
          if (!hit) return next();
          var h = {};
          var et = hit.headers.get('etag'), lm = hit.headers.get('last-modified');
          if (et) h['If-None-Match'] = et;
          else if (lm) h['If-Modified-Since'] = lm;
          else return next();                      // 물어볼 단서가 없으면 건너뜀
          return fetch(r.url, { headers: h, cache: 'no-store', credentials: 'same-origin' }).then(function (resp) {
            if (resp && resp.status === 200) return cache.put(r.url, resp);
          }).catch(function () {}).then(next);
        });
      }
      return next();
    });
  });
}

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'revalidate') e.waitUntil(revalidateAll().catch(function () {}));
});
