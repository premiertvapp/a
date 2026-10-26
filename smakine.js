// filmmakinesi.to kaynak eklentisi — sadece film bolumu (dizi kismi yok).
// Yardimcilar: doc(url), text(url), http(url,{method,headers})->{code,url,text},
//   sel(el,css), txt(el), attr(el,"href"), re(str,regex), abs(url),
//   extractor(url), log(...)
//
// Akis zinciri (THYTV FilmMakinesiRepository portu):
//   liste: /filmler-1/ ve /filmler-1/sayfa/{N}/ -> a.item kartlari
//   detay: #info--box (baslik/yil/tur/sure/ulke/ozet)
//   embed: #player-section .video-parts a[data-video_url] + iframe'ler
//   stream cozum sirasi: file:"literal" -> sayfa JS'i sandbox'ta calistirilir
//     -> file:<var> = fn("payload".split(sep)) closeload statik cozumu
//     -> atob/duz degisken -> packer icinde ayni tarama -> duz m3u8 -> video>source
//   altyazilar: jwplayer tracks:[{file,kind,label,default}]

var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var FM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// base64 -> byte-string (charCode = byte)
function b64dec(input) {
    var str = String(input).replace(/[^A-Za-z0-9+\/]/g, "");
    var out = "", bc = 0, bs = 0;
    for (var i = 0; i < str.length; i++) {
        var v = B64.indexOf(str.charAt(i));
        if (v < 0) continue;
        bc = (bc << 6) | v; bs += 6;
        if (bs >= 8) { bs -= 8; out += String.fromCharCode((bc >> bs) & 0xFF); }
    }
    return out;
}

// "N Yorum" ve " izle" son eklerini temizler (cleanTitle portu)
function cleanTitle(s) {
    return String(s || "")
        .replace(/\s*[-–—]?\s*\d+\s*[Yy]orum\b[\s\S]*$/, "")
        .replace(/\s+izle\s*$/i, "")
        .replace(/\s+İzle\s*$/, "")
        .trim();
}

function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}

// closeload/rapid: var X = fn("p1@p2@..@pN".split("@")) obfuscation cozucusu
// (CloseLoadDecoder portu — sabit algoritma, degisken/fonksiyon adlari serbest)
// Not: key parcasina location.hostname eklenir (embed sayfasi bunu yapar)
function closeLoadDecode(parts, host) {
    var work = parts.slice();
    var n0 = work.length - 2;
    var keyIndex = n0 % 7;
    var opsIndex = 8 + (n0 % 5);
    if (opsIndex >= work.length || keyIndex >= work.length) return "";

    var ops = work.splice(opsIndex, 1)[0];
    var key = work.splice(keyIndex, 1)[0] + String(host || "");
    var data = work.join("");
    if (ops.length > 2048) data = data.split("").reverse().join("");

    var w02 = 0, bp2o = 0;
    for (var i = 0; i < key.length; i++) {
        var c = key.charCodeAt(i);
        w02 = (w02 * 37 + c) % 241;
        bp2o = (bp2o + ((c << 1) ^ i)) & 255;
    }
    var seed = (w02 * 3 + bp2o) % 256;
    var step = (bp2o % 11) + 5;
    var rng = ((bp2o * 251 + w02) % 65519) + 1;

    for (i = ops.length - 1; i >= 0; i--) {
        var oc = ops.charAt(i);
        if (oc === "7") {
            data = b64dec(data);
        } else if (oc === "3") {
            data = data.split("").reverse().join("");
        } else {
            var shift = (26 - ((oc.charCodeAt(0) - 96) % 26)) % 26;
            data = data.replace(/[a-zA-Z]/g, function (ch) {
                var base = ch <= "Z" ? 65 : 97;
                return String.fromCharCode(((ch.charCodeAt(0) - base + shift) % 26) + base);
            });
        }
    }
    if (key.length > 4096) data = b64dec(data);

    var len = data.length;
    if (len < 2) return "";
    var order = [];
    for (i = len - 1; i >= 1; i--) {
        rng = (rng * 97 + 41) % 65519;
        order[i] = rng % (i + 1);
    }
    var chars = data.split("");
    for (i = 1; i < len; i++) {
        var j = order[i], t = chars[i];
        chars[i] = chars[j]; chars[j] = t;
    }

    var out = "", state = seed;
    for (i = 0; i < len; i++) {
        var code = chars[i].charCodeAt(0);
        state = (state * 5 + step) % 256;
        out += String.fromCharCode(code ^ state);
        state = (state + code) % 256;
    }
    return out;
}

// Dean Edwards packer icin base-N sembolu (base62'de A-Z, Kotlin toBase portu)
function toBase(c, radix) {
    var ALNUM = "0123456789abcdefghijklmnopqrstuvwxyz";
    var head = c >= radix ? toBase(Math.floor(c / radix), radix) : "";
    var r = c % radix;
    return head + (r > 35 ? String.fromCharCode(r + 29) : ALNUM.charAt(r));
}

// eval(function(p,a,c,k,e,d){...}) govdesini cozer
function unpackPacker(src) {
    var m = /\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'/.exec(src);
    if (!m) return "";
    var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    var radix = parseInt(m[2], 10), count = parseInt(m[3], 10);
    if (!radix || !count) return "";
    var kw = m[4].split("|");
    var sym = {};
    for (var c = 0; c < count; c++) {
        var s = toBase(c, radix);
        var w = c < kw.length ? kw[c] : "";
        sym[s] = w || s;
    }
    return payload.replace(/\b\w+\b/g, function (w0) {
        return sym.hasOwnProperty(w0) ? sym[w0] : w0;
    });
}

// html'deki tum packer bloklarini cozup metin olarak doner
function packerTexts(html) {
    var out = [], pos = 0;
    while (true) {
        var start = html.indexOf("eval(function(p,a,c,k,e,d)", pos);
        if (start === -1) break;
        var endMarker = ".split('|')))";
        var end = html.indexOf(endMarker, start);
        var packed = end === -1 ? html.substring(start) : html.substring(start, end + endMarker.length);
        pos = start + 1;
        var dec = unpackPacker(packed);
        if (dec) out.push(dec);
    }
    return out;
}

// VAR = fn("PAYLOAD".split("SEP")) cagrisini bulur; tirnak tipi serbest
function splitCallDecode(hay, varName, host) {
    var re = new RegExp("\\b" + varName + "\\s*=\\s*[A-Za-z_$][\\w$]*\\s*\\(", "g"), m;
    while ((m = re.exec(hay))) {
        var i = m.index + m[0].length;
        while (i < hay.length && /\s/.test(hay.charAt(i))) i++;
        var q = hay.charAt(i);
        if (q !== '"' && q !== "'") continue;
        var j = i + 1, payload = "";
        while (j < hay.length) {
            var ch = hay.charAt(j);
            if (ch === "\\") { payload += hay.substr(j, 2); j += 2; continue; }
            if (ch === q) break;
            payload += ch; j++;
        }
        if (hay.charAt(j) !== q) continue;
        var rest = hay.substr(j + 1, 60);
        var sm = /^\s*\.\s*split\s*\(\s*(['"])([\s\S]*?)\1/.exec(rest);
        if (!sm) continue;
        var dec = closeLoadDecode(payload.replace(/\\\//g, "/").split(sm[2]), host);
        if (dec.indexOf("http") === 0) return dec;
    }
    return null;
}

// ---------------- yerel playlist sunucusu ----------------
// Uygulamanin HLS yolu disaridan donen subtitles listesini yutuyor; altyazilar
// ayrica CF/PHPSESSID istiyor ve X-TIMESTAMP-MAP'siz oldugundan ~1.48s erken
// gosteriliyor. Cozum (dizimag/dizilla deseni): VTT'yi biz cekip map enjekte
// edip 127.0.0.1'den servis ederiz; master playlist'e SUBTITLES rendition'lari
// eklenip yine yerelden servis edilir.

var FM_SLOTS = {};

// video ilk PTS'si (ffprobe start_time=1.483422 olculdu; ffmpeg TS encode'u)
var FM_SUB_MPEGTS = 133508; // 1.483422s * 90000

// idx -> tek govde servis eden yerel soket; donen URL "http://127.0.0.1:<port>/x.m3u8"
function fmServeSlot(idx, body) {
    var e = FM_SLOTS[idx];
    if (e) { e.body = body; return "http://127.0.0.1:" + e.port + "/x.m3u8"; }
    if (typeof Packages === "undefined") return null;
    try {
        var ss = new Packages.java.net.ServerSocket(0, 50, Packages.java.net.InetAddress.getByName("127.0.0.1"));
        var slot = { port: ss.getLocalPort(), body: body };
        FM_SLOTS[idx] = slot;
        var r = new Packages.java.lang.Runnable({ run: function () {
            while (true) {
                var s = null;
                try { s = ss.accept(); } catch (e0) { break; }
                try {
                    var b = new Packages.java.lang.String(slot.body || "#EXTM3U\n").getBytes("UTF-8");
                    var head = new Packages.java.lang.String(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\n" +
                        "Content-Length: " + b.length + "\r\nConnection: close\r\n\r\n").getBytes("ISO-8859-1");
                    var out = s.getOutputStream();
                    out.write(head);
                    out.write(b);
                    out.flush();
                } catch (e1) { }
                try { s.close(); } catch (e2) { }
            }
        }});
        var t = new Packages.java.lang.Thread(r);
        t.setDaemon(true);
        t.start();
        return "http://127.0.0.1:" + slot.port + "/x.m3u8";
    } catch (e) { log("filmmakinesi yerel sunucu:", e); return null; }
}

// VTT basligina X-TIMESTAMP-MAP ekle -> cue'lar video PTS eksenine hizalanir
function fmInjectTsMap(vtt, mpegts) {
    vtt = String(vtt || "");
    if (vtt.indexOf("X-TIMESTAMP-MAP") >= 0) return vtt;
    var i = vtt.indexOf("WEBVTT");
    if (i < 0) return vtt;
    var nl = vtt.indexOf("\n", i);
    if (nl < 0) return vtt;
    return vtt.substring(0, nl + 1) +
        "X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:" + mpegts + "\n" +
        vtt.substring(nl + 1);
}

// SUBTITLES rendition URI'si m3u8 ister; VTT'yi tek segmentli playlist'e sar
function fmSubPlaylist(srcUrl, dur) {
    var d = Math.ceil(dur || 7200);
    return "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:" + d +
        "\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
        "#EXTINF:" + d + ".000,\n" + srcUrl + "\n#EXT-X-ENDLIST\n";
}

// goreli URI'yi playlist base'ine gore mutlak yap (sublist_*.txt vb.)
function fmAbs(base, u) {
    u = String(u || "");
    if (u.indexOf("http") === 0) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    var m = /^(https?:\/\/[^\/]+)/.exec(base);
    var origin = m ? m[1] : base;
    if (u.indexOf("/") === 0) return origin + u;
    var dir = base.replace(/[?#].*$/, "");
    dir = dir.substring(0, dir.lastIndexOf("/") + 1);
    return dir + u;
}

// subs: [{name, code, def, uri}] -> #EXT-X-MEDIA satirlari
function fmSubLines(subs) {
    var out = [];
    for (var i = 0; i < subs.length; i++) {
        var s = subs[i];
        out.push('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="' +
            String(s.name || "Altyazi").replace(/"/g, "'") + '"' +
            (s.code ? ',LANGUAGE="' + String(s.code).replace(/"/g, "") + '"' : '') +
            ',DEFAULT=' + (s.def ? "YES" : "NO") + ',AUTOSELECT=' + (s.def ? "YES" : "NO") +
            ',FORCED=NO,URI="' + s.uri + '"');
    }
    return out;
}

// gercek master playlist'e subs grubunu ekler + goreli URI'leri mutlaklar;
// media playlist ise null doner
function fmMasterWithSubs(master, base, subLines) {
    var lines = master.split("\n"), out = [], done = false;
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].replace(/\r$/, "");
        ln = ln.replace(/URI="([^"]*)"/g, function (m, u) {
            return u.indexOf("http") === 0 ? m : 'URI="' + fmAbs(base, u) + '"';
        });
        if (ln.indexOf("#EXT-X-STREAM-INF") === 0) {
            if (!done) { out = out.concat(subLines); done = true; }
            if (ln.indexOf("SUBTITLES=") < 0) ln += ',SUBTITLES="subs"';
        } else if (ln.length && ln.charAt(0) !== "#" && ln.indexOf("http") !== 0) {
            ln = fmAbs(base, ln);
        }
        out.push(ln);
    }
    return done ? out.join("\n") : null;
}

// playlist media ise sentetik master'a sarip subs grubunu baglar
function fmWrapMedia(playlistUrl, subLines) {
    return "#EXTM3U\n" + subLines.join("\n") +
        "\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,SUBTITLES=\"subs\"\n" + playlistUrl + "\n";
}

var provider = {
    name: "FilmMakinesi (JS)",
    mainUrl: "https://filmmakinesi.to",
    mirrors: ["https://filmmakinesi.to"],
    lang: "tr",
    supportedTypes: ["Movie"],
    mainPage: [
       
    ],

    fixUrl: function (u) {
        if (!u) return u;
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        if (u.indexOf("/") === 0) return this.mainUrl + u;
        return this.mainUrl + "/" + u;
    },

    // srcset icindeki en yuksek cozunurluklu gorseli secer
    bestSrcset: function (srcset) {
        if (!srcset) return null;
        var best = null, bw = 0;
        var parts = String(srcset).split(",");
        for (var i = 0; i < parts.length; i++) {
            var tok = parts[i].trim().split(/\s+/);
            var url = tok[0];
            var w = tok[1] ? (parseInt(re(tok[1], "(\\d+)"), 10) || 0) : 0;
            if (url && w >= bw) { bw = w; best = url; }
        }
        return best;
    },

    // a.item karti -> film karti; /dizi/ linkleri atlanir (sadece film)
    card: function (el) {
        var url = attr(el, "href");
        if (!url || url.indexOf("/dizi/") !== -1) return null;

        var name = String(attr(el, "data-title") || "").trim();
        if (!name) name = txt(sel(el, ".item-footer .title")[0]);
        var im0 = sel(el, "img")[0];
        if (!name) name = String(attr(im0, "alt") || "").trim();
        if (!name) return null;

        var year = null;
        var spans = sel(el, ".info span");
        for (var i = 0; i < spans.length; i++) {
            var st = txt(spans[i]).trim();
            if (st.length === 4 && /^\d{4}$/.test(st)) { year = parseInt(st, 10); break; }
        }

        var poster = this.bestSrcset(attr(im0, "srcset"))
            || attr(im0, "src") || attr(im0, "data-src") || "";

        var genre = String(attr(el, "data-type") || "").split(",");
        var gl = [];
        for (var g = 0; g < genre.length && gl.length < 2; g++) {
            var t = genre[g].trim();
            if (t) gl.push(t);
        }

        return {
            name: cleanTitle(name),
            url: url,
            posterUrl: this.fixUrl(poster),
            year: year,
            rating: parseFloat(attr(el, "data-score")) || null,
            quality: gl.join(", "),
            type: "Movie"
        };
    },

    getMainPage: function (page, req) {
        var cfg = null;
        var mp = this.mainPage;
        for (var i = 0; i < mp.length; i++) if (mp[i].name === req.name) cfg = mp[i];
        if (!cfg) return { items: [], hasNext: false };
        var url = (cfg.paging && page > 1) ? cfg.url + "sayfa/" + page + "/" : cfg.url;
        var d;
        try { d = doc(abs(url)); } catch (e) { return { items: [], hasNext: false }; }
        var out = sel(d, cfg.list);
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.name && c.url) list.push(c);
        }
        return { items: [{ name: req.name, list: list, type: "Movie" }], hasNext: list.length > 0 };
    },

    // /arama/?s= — film ve dizi karisik gelir; dizi sonuclari elenir
    search: function (query) {
        var d;
        try {
            d = doc(this.mainUrl + "/arama/?s=" + encodeURIComponent(query));
        } catch (e) { return []; }
        var out = sel(d, "a.item");
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.name && c.url) list.push(c);
        }
        return list;
    },

    // film detayi: #info--box kunyasi
    load: function (url) {
        var d = doc(this.fixUrl(url));
        var info = sel(d, "#info--box")[0] || d;

        var titleEl = sel(info, "h1.title")[0];
        var year = txt(sel(info, "h1.title .date a")[0]).trim();
        var name = titleEl ? txt(titleEl).replace(/\s*\d{4}\s*$/, "").trim() : "";
        if (!name) name = re(String(url), "/film/([^/]+)/");
        name = cleanTitle((name || "Film").replace(/-/g, " "));

        var genre = "";
        var gEl = sel(info, ".info .type")[0];
        if (gEl) {
            var ga = sel(gEl, "a"), gp = [];
            for (var i = 0; i < ga.length; i++) { var t = txt(ga[i]).trim(); if (t) gp.push(t); }
            genre = gp.join(", ") || txt(gEl).replace(/Tür:/, "").trim();
        }
        var duration = txt(sel(info, ".info .time")[0]).replace(/Süre:/, "").trim();
        var countryEl = sel(info, ".info .country")[0];
        var country = countryEl
            ? (txt(sel(countryEl, "a")[0]).trim() || txt(countryEl).replace(/Ülke:/, "").trim())
            : "";
        var plot = txt(sel(info, ".info-description p")[0]).trim()
            || attr(sel(d, 'meta[name="description"]')[0], "content") || "";

        var meta = [genre, duration, country].filter(function (x) { return x; }).join(" · ");
        var poster = attr(sel(info, ".cover img")[0], "src")
            || attr(sel(d, "#player-section .before-player img")[0], "src") || "";

        return {
            name: name,
            url: url,
            type: "Movie",
            posterUrl: this.fixUrl(poster),
            plot: meta ? meta + "\n\n" + plot : plot,
            year: parseInt(year, 10) || null,
            rating: parseFloat(txt(sel(info, ".imdb b")[0])) || null,
            dataUrl: this.fixUrl(url),
            episodes: [{ data: this.fixUrl(url), name: "Film", season: 1, episode: 1 }]
        };
    },

    // film sayfasindaki izleme hedefleri: video-parts + iframe'ler (fragman haric)
    watchTargets: function (d) {
        var links = [];
        var seen = {};
        var parts = sel(d, "#player-section .video-parts a[data-video_url]");
        for (var i = 0; i < parts.length; i++) {
            var u = String(attr(parts[i], "data-video_url") || "").trim();
            if (u && !seen[u]) { seen[u] = 1; links.push(u); }
        }
        var frames = sel(d, "iframe");
        for (var f = 0; f < frames.length; f++) {
            var fu = String(attr(frames[f], "data-src") || attr(frames[f], "src") || "").trim();
            if (fu && !seen[fu]) { seen[fu] = 1; links.push(fu); }
        }
        var out = [];
        for (var k = 0; k < links.length; k++) {
            var l = links[k];
            if (l.indexOf("http") === 0 && l.indexOf("youtube.com") === -1 && l.indexOf("youtu.be") === -1) {
                out.push(l);
            }
        }
        return out;
    },

    // Sayfanin inline script'lerini taklit ortamda calistirip stream degiskenini okur.
    // (JsSandbox portu — decoder sayfadan calistirildigi icin algoritma/degisken
    // adi degisse bile calisir; sadece taklit ortamin eksiksiz olmasi gerekir.)
    sandboxStream: function (html, varNames, host, embedUrl) {
        try {
            if (typeof Function !== "function") return null;
            var scripts = [];
            var tagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, tm;
            while ((tm = tagRe.exec(html))) {
                var at = tm[1] || "";
                if (/\bsrc\s*=/.test(at) || /ld\+json/i.test(at)) continue;
                var body = tm[2];
                if (body && body.replace(/\s+/g, "")) scripts.push(body);
            }
            if (!scripts.length) return null;

            var hostSafe = String(host || "").replace(/[^A-Za-z0-9.\-]/g, "");
            var urlSafe = String(embedUrl || "").replace(/['"\\<>\s]/g, "");
            var origin = hostSafe ? "https://" + hostSafe : "";

            var pre =
                "function __el(){return{style:{},dataset:{},innerHTML:'',src:''," +
                "classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false}}," +
                "addEventListener:function(){},removeEventListener:function(){},setAttribute:function(){},getAttribute:function(){return null}," +
                "appendChild:function(){},removeChild:function(){},querySelector:function(){return null},querySelectorAll:function(){return[]}}}" +
                "var location={href:'" + urlSafe + "',protocol:'https:',host:'" + hostSafe + "',hostname:'" + hostSafe + "'," +
                "origin:'" + origin + "',pathname:'/',search:'',hash:'',port:''," +
                "assign:function(){},replace:function(){},reload:function(){},toString:function(){return this.href}};" +
                "var document={addEventListener:function(){},removeEventListener:function(){},getElementById:function(){return __el()}," +
                "createElement:function(){return __el()},getElementsByTagName:function(){return[]},getElementsByClassName:function(){return[]}," +
                "querySelector:function(){return null},querySelectorAll:function(){return[]},write:function(){},writeln:function(){}," +
                "body:__el(),head:__el(),documentElement:__el(),cookie:'',referrer:'',readyState:'complete',visibilityState:'visible'," +
                "location:location,domain:'" + hostSafe + "',URL:'" + urlSafe + "',documentURI:'" + urlSafe + "',baseURI:'" + urlSafe + "'," +
                "charset:'UTF-8',currentScript:__el(),scripts:[]};" +
                "var navigator={userAgent:'" + FM_UA + "',language:'tr-TR',languages:['tr-TR','tr'],platform:'Win32'," +
                "vendor:'Google Inc.',appVersion:'5.0',webdriver:false,plugins:[],mimeTypes:[]};" +
                "var screen={width:1920,height:1080,colorDepth:24};" +
                "var history={pushState:function(){},replaceState:function(){},back:function(){},forward:function(){},go:function(){},state:null,length:1};" +
                "var localStorage={getItem:function(){return null},setItem:function(){},removeItem:function(){},clear:function(){}};var sessionStorage=localStorage;" +
                "var console={log:function(){},error:function(){},warn:function(){},info:function(){},debug:function(){},clear:function(){}};" +
                "function setTimeout(){return 0}function setInterval(){return 0}function clearTimeout(){}function clearInterval(){}" +
                "function addEventListener(){}function removeEventListener(){}" +
                "var window={};window.parent=window;window.top=window;window.self=window;window.frames=window;window.window=window;" +
                "window.location=location;window.document=document;window.navigator=navigator;window.screen=screen;window.history=history;" +
                "window.localStorage=localStorage;window.sessionStorage=sessionStorage;window.console=console;" +
                "window.innerWidth=1920;window.innerHeight=1080;window.devicePixelRatio=1;" +
                "window.addEventListener=function(){};window.removeEventListener=function(){};window.postMessage=function(){};" +
                "window.open=function(){return __el()};window.close=function(){};window.globalThis=window;" +
                "var self=window,top=window,parent=window;" +
                "var Image=function(){return __el()};var Worker=function(){return{postMessage:function(){},terminate:function(){},addEventListener:function(){}}};" +
                "var WebSocket=function(){return{send:function(){},close:function(){},addEventListener:function(){}}};" +
                "var XMLHttpRequest=function(){return{open:function(){},send:function(){},addEventListener:function(){},setRequestHeader:function(){},readyState:4,status:200,responseText:''}};" +
                "var fetch=function(){return{then:function(){return this},catch:function(){return this}}};" +
                "var crypto={getRandomValues:function(a){return a},subtle:{}};var performance={now:function(){return 0},timing:{}};" +
                "var getComputedStyle=function(){return{getPropertyValue:function(){return ''}}};" +
                "var MutationObserver=function(){return{observe:function(){},disconnect:function(){},takeRecords:function(){return[]}}};var IntersectionObserver=MutationObserver;" +
                "var requestAnimationFrame=function(){return 0};var cancelAnimationFrame=function(){};" +
                "var matchMedia=function(){return{matches:false,media:'',addListener:function(){},addEventListener:function(){}}};window.matchMedia=matchMedia;" +
                "var __T='" + B64 + "';" +
                "var atob=function(s){s=String(s).replace(/[^A-Za-z0-9+\\/]/g,'');var o='',b=0,n=0;" +
                "for(var i=0;i<s.length;i++){var v=__T.indexOf(s.charAt(i));if(v<0)continue;b=(b<<6)|v;n+=6;" +
                "if(n>=8){n-=8;o+=String.fromCharCode((b>>n)&255)}}return o};window.atob=atob;" +
                "var btoa=function(s){s=String(s);var o='';for(var i=0;i<s.length;i+=3){var a=s.charCodeAt(i)&255," +
                "b=i+1<s.length?s.charCodeAt(i+1)&255:NaN,c=i+2<s.length?s.charCodeAt(i+2)&255:NaN;" +
                "o+=__T.charAt(a>>2)+__T.charAt(((a&3)<<4)|((b||0)>>4))+(isNaN(b)?'=':__T.charAt(((b&15)<<2)|((c||0)>>6)))+(isNaN(c)?'=':__T.charAt(c&63))}return o};window.btoa=btoa;" +
                "var __jw=null;" +
                "var jwplayer=function(){var p={setup:function(c){__jw=c;return p}};" +
                "var ks='on once off addButton removeButton seek play pause setCurrentCaptions setCurrentAudioTrack addCues remove resize'.split(' ');" +
                "for(var i=0;i<ks.length;i++){p[ks[i]]=function(){return p}}" +
                "p.getPlaylist=function(){return[]};p.getContainer=function(){return __el()};p.getFullscreen=function(){return false};return p};" +
                "window.jwplayer=jwplayer;" +
                "var jQuery=function(a){if(typeof a==='function'){try{a()}catch(e){}}var q={length:0};" +
                "var ks='on off html find css attr each addClass removeClass show hide append prepend text val click remove fadeIn fadeOut parent children'.split(' ');" +
                "for(var i=0;i<ks.length;i++){q[ks[i]]=function(){return q}}" +
                "q.ready=function(f){if(typeof f==='function'){try{f()}catch(e){}}return q};return q};" +
                "var $=jQuery;window.jQuery=jQuery;window.$=$;";

            var run =
                "for(var i=0;i<__S.length;i++){try{eval(__S[i])}catch(e){}}" +
                "for(var i=0;i<__N.length;i++){var v=null;try{v=eval(__N[i])}catch(e){}" +
                "if((v===null||v===undefined)&&window[__N[i]]!==undefined)v=window[__N[i]];" +
                "if(v&&String(v).indexOf('http')===0)return String(v);}" +
                "try{if(__jw){var s=__jw.sources||(__jw.playlist&&__jw.playlist[0]&&__jw.playlist[0].sources);" +
                "if(s&&s[0]&&s[0].file)return String(s[0].file);" +
                "if(__jw.playlist&&__jw.playlist[0]&&__jw.playlist[0].file)return String(__jw.playlist[0].file);" +
                "if(__jw.file)return String(__jw.file);}}catch(e){}" +
                "return '';";

            var fn = new Function("__S", "__N", pre + run);
            var names = [];
            for (var n = 0; n < (varNames || []).length; n++) {
                if (/^[A-Za-z_$][\w$]*$/.test(varNames[n])) names.push(varNames[n]);
            }
            var out = fn(scripts, names);
            return (out && String(out).indexOf("http") === 0) ? String(out) : null;
        } catch (e) { return null; }
    },

    // goreli /vtt/... yollarini embed host'una baglar
    resolveSub: function (embedUrl, u) {
        u = String(u || "").replace(/\\\//g, "/");
        if (!u) return u;
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        var m = /^(https?:\/\/[^\/]+)/.exec(embedUrl);
        if (u.indexOf("/") === 0 && m) return m[1] + u;
        return u;
    },

    // jwplayer tracks:[...] dizisinden altyazilari cikarir
    extractTracks: function (h, embedUrl) {
        var subs = [];
        var tm = /tracks\s*:\s*(\[[\s\S]*?\])\s*[,}\n]/.exec(h);
        if (!tm) return subs;
        var arr = null;
        try { arr = JSON.parse(tm[1]); } catch (e) { arr = null; }
        if (!arr) {
            var fm, fr = /"file"\s*:\s*"([^"]+)"/g;
            while ((fm = fr.exec(tm[1]))) {
                var fu = fm[1].replace(/\\\//g, "/");
                if (/\.vtt|\.srt/i.test(fu)) subs.push({ lang: "Altyazi", url: this.resolveSub(embedUrl, fu) });
            }
            return subs;
        }
        for (var i = 0; i < arr.length; i++) {
            var t = arr[i] || {};
            var kind = t.kind || "";
            if (kind && kind !== "captions" && kind !== "subtitles") continue;
            var f = t.file || "";
            if (!f) continue;
            subs.push({
                lang: (t.label || t.language || "Altyazi"),
                code: t.language || "",
                def: !!t.default,
                url: this.resolveSub(embedUrl, f)
            });
        }
        return subs;
    },

    // embed html'inden stream URL'sini cozer
    extractStreamUrl: function (h, embed) {
        var hm = /^https?:\/\/([^\/:?#]+)/.exec(String(embed || ""));
        var host = hm ? hm[1] : "";
        var hay = h;
        var pks = packerTexts(h);
        for (var p = 0; p < pks.length; p++) hay += "\n" + pks[p];

        // 1) file: "https://..." literal (altyazi dosyalari haric)
        var m, reFile = /file\s*:\s*"([^"]+)"/g;
        while ((m = reFile.exec(hay))) {
            var u = m[1].replace(/\\\//g, "/");
            if (u.indexOf("http") === 0 && !/\.vtt|\.srt/i.test(u)) return u;
        }

        // file: VAR / file:atob(VAR) adaylari (yorum satirlari temizlenmis halde)
        var clean = hay.replace(/^\s*\/\/.*$/gm, "");
        var vars = [], mm, reVar = /file\s*:\s*(?:atob\(\s*)?([A-Za-z_$][\w$]*)/g;
        while ((mm = reVar.exec(clean))) {
            if (vars.indexOf(mm[1]) === -1) vars.push(mm[1]);
        }
        // VAR = fn("...".split(..)) hedefleri — "file:" anahtari degisse bile yakala
        var reCall = /\b([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*\(\s*['"][^'"]{16,}['"]\s*\.\s*split/g;
        while ((mm = reCall.exec(clean))) {
            if (vars.indexOf(mm[1]) === -1) vars.push(mm[1]);
        }

        // 2) sandbox: sayfa JS'ini calistir, aday degiskenleri/jw setup'u oku
        var sv = this.sandboxStream(h, vars, host, embed);
        if (sv) return sv;

        // 3) her aday icin: split-cagri closeload cozumu, sonra literal/atob
        for (var vi = 0; vi < vars.length; vi++) {
            var vn = vars[vi];
            var dec = splitCallDecode(hay, vn, host);
            if (dec) return dec;

            var lv = new RegExp("\\b" + vn + "\\s*=\\s*([\"'])([^\"']{8,})\\1").exec(hay);
            if (lv) {
                var dv = lv[2];
                if (dv.indexOf("http") === 0) return dv;
                var dvb = b64dec(dv);
                if (dvb.indexOf("http") === 0) return dvb;
            }
        }

        // 4) ld+json haric duz m3u8/mp4 URL taramasi
        var scan = h.replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, " ");
        var um, ur = /https?:\/\/[a-zA-Z0-9.\/?:&=+_%#@!-]+/g;
        while ((um = ur.exec(scan))) {
            var uu = um[0];
            if (uu.indexOf(".m3u8") !== -1 || uu.indexOf("/master") !== -1 ||
                (uu.indexOf(".mp4") !== -1 && uu.indexOf("/hls/") !== -1)) return uu;
        }

        // 5) video>source etiketleri
        var vm = /<video[^>]*>\s*<source[^>]*src=["']([^"']+)/i.exec(h)
            || /<video[^>]*src=["']([^"']+)/i.exec(h);
        if (vm && vm[1]) return vm[1];
        return null;
    },

    resolveEmbed: function (embed, filmUrl) {
        var h = getText(embed, { "Referer": filmUrl, "User-Agent": FM_UA });
        if (!h) return null;
        var stream = this.extractStreamUrl(h, embed);
        if (!stream) return null;
        var om = /^(https?:\/\/[^\/]+)/.exec(embed);
        return {
            stream: stream,
            subs: this.extractTracks(h, embed),
            referer: embed,
            origin: om ? om[1] : this.mainUrl
        };
    },

    loadLinks: function (data) {
        var filmUrl = this.fixUrl(data);
        var links = [], subs = [];
        var d;
        try { d = doc(filmUrl); } catch (e) { d = null; }
        if (!d) return { links: links, subtitles: subs };

        var embeds = this.watchTargets(d);
        for (var i = 0; i < embeds.length; i++) {
            var e = embeds[i];
            var host = re(e, "https?://([a-z0-9]+)") || "embed";
            var tag = "FM " + host.charAt(0).toUpperCase() + host.slice(1);
            var r = null;
            try { r = this.resolveEmbed(e, filmUrl); } catch (ex) { r = null; }
            if (r && r.stream) {
                var isHls = /\.m3u8/i.test(r.stream) || r.stream.indexOf("/hls/") !== -1 ||
                    r.stream.indexOf("/master") !== -1;
                // altyazilari yerellestir: biz cekip map enjekte edip yerelden servis ederiz
                // (CF/cookie/referer engelini atlar, erken-gelme senkron sorununu cozer)
                for (var si = 0; si < r.subs.length; si++) {
                    var vtt = getText(r.subs[si].url, { "Referer": r.referer, "User-Agent": FM_UA });
                    if (vtt && vtt.indexOf("WEBVTT") >= 0) {
                        var vu = fmServeSlot("fmv" + i + "_" + si, fmInjectTsMap(vtt, FM_SUB_MPEGTS));
                        if (vu) r.subs[si]._local = vu;
                    }
                }
                // HLS ise master playlist'e SUBTITLES rendition'lari eklenmis yerel link
                var localUrl = null;
                if (isHls && r.subs.length) {
                    var pl = getText(r.stream, { "Referer": r.referer, "User-Agent": FM_UA });
                    if (pl && pl.indexOf("#EXTM3U") >= 0) {
                        var hasTr = false, localSubs = [];
                        for (var s2 = 0; s2 < r.subs.length; s2++) {
                            if (/turk|türk|^tr$/i.test(r.subs[s2].lang + r.subs[s2].code)) hasTr = true;
                        }
                        for (var s3 = 0; s3 < r.subs.length; s3++) {
                            var su2 = fmServeSlot("fms" + i + "_" + s3,
                                fmSubPlaylist(r.subs[s3]._local || r.subs[s3].url, 7200));
                            if (su2) localSubs.push({
                                name: r.subs[s3].lang, code: r.subs[s3].code,
                                def: r.subs[s3].def ||
                                    /turk|türk|^tr$/i.test(r.subs[s3].lang + r.subs[s3].code) ||
                                    (!hasTr && s3 === 0),
                                uri: su2
                            });
                        }
                        if (localSubs.length) {
                            var body = fmMasterWithSubs(pl, r.stream, fmSubLines(localSubs));
                            if (!body) body = fmWrapMedia(r.stream, fmSubLines(localSubs));
                            localUrl = fmServeSlot("fmm" + i, body);
                        }
                    }
                }
                if (localUrl) {
                    links.push({
                        url: localUrl,
                        name: tag + " (Altyazılı)",
                        source: this.name,
                        referer: r.referer,
                        headers: {
                            "Referer": r.referer,
                            "Origin": r.origin,
                            "User-Agent": FM_UA
                        },
                        isM3u8: true,
                        type: "hls"
                    });
                }
                links.push({
                    url: r.stream,
                    name: tag,
                    source: this.name,
                    referer: r.referer,
                    headers: {
                        "Referer": r.referer,
                        "Origin": r.origin,
                        "User-Agent": FM_UA
                    },
                    isM3u8: isHls,
                    type: isHls ? "hls" : "direct"
                });
                for (var s = 0; s < r.subs.length; s++) {
                    subs.push({ lang: r.subs[s].lang, url: r.subs[s]._local || r.subs[s].url });
                }
            } else {
                // cozulemeyen embed'i uygulamanin genel extractor'ina birak
                links.push({ url: e, name: tag, source: this.name, referer: filmUrl, type: "embed" });
            }
        }
        log("loadLinks:", filmUrl, "| embed:", embeds.length, "| link:", links.length, "| sub:", subs.length);
        return { links: links, subtitles: subs };
    }
};
