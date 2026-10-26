// fullhdfilmizlesene.now kaynak eklentisi — CloudMediaPlayer JS köprüsü, tamamen JS (python gerekmez).
// Yardımcılar: doc(url,headers?), text(url,headers?), post(url,form,headers?)->string,
//   http(url,{method,headers,data,body})->{code,url,text}, sel, txt, html, attr(href/src=absUrl),
//   re, abs, extractor, log
//
// Akış (sitenin kendisiyle aynı):
//   film sayfası -> var scx = {...} -> tt=b64 isim, sx.t/sx.p = rot13+b64 embed URL'leri
//   embed /vx/  -> window._p8='..' -> obfDecode -> {cm,tm: stream, ct: altyazı}
//   embed /vod/ -> "file":av('..') -> obfDecode -> stream + jwSetup.tracks
//   obfDecode  -> reverse -> b64 -> byte - K9L[1,3,2] -> b64 -> utf8
//   turbo isimli kaynak -> id alınır -> turbo.imgz.me/play/<id>


var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var OBF_KEY = [1, 3, 2]; // "K9L" -> ord%5+1


// base64 -> byte-string (charCode = byte)
function b64dec(input) {
    var str = String(input);
    var out = "", bc = 0, bs = 0;
    for (var i = 0; i < str.length; i++) {
        var v = B64.indexOf(str.charAt(i));
        if (v < 0) continue;
        bc = (bc << 6) | v; bs += 6;
        if (bs >= 8) { bs -= 8; out += String.fromCharCode((bc >> bs) & 0xFF); }
    }
    return out;
}


// byte-string -> utf8 metin
function utf8dec(s) {
    var out = "", i = 0;
    while (i < s.length) {
        var c = s.charCodeAt(i);
        if (c < 0x80) { out += String.fromCharCode(c); i += 1; }
        else if (c < 0xE0) {
            out += String.fromCharCode(((c & 0x1F) << 6) | (s.charCodeAt(i + 1) & 0x3F)); i += 2;
        } else if (c < 0xF0) {
            out += String.fromCharCode(((c & 0x0F) << 12) | ((s.charCodeAt(i + 1) & 0x3F) << 6) | (s.charCodeAt(i + 2) & 0x3F)); i += 3;
        } else {
            var cp = ((c & 0x07) << 18) | ((s.charCodeAt(i + 1) & 0x3F) << 12) |
                ((s.charCodeAt(i + 2) & 0x3F) << 6) | (s.charCodeAt(i + 3) & 0x3F);
            cp -= 0x10000;
            out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); i += 4;
        }
    }
    return out;
}


function rot13(s) {
    return s.replace(/[a-zA-Z]/g, function (c) {
        var o = c.charCodeAt(0);
        return String.fromCharCode(o <= 90 ? ((o - 65 + 13) % 26) + 65 : ((o - 97 + 13) % 26) + 97);
    });
}


// sx.t/sx.p elemani: rot13 -> b64 -> utf8
function scxDecode(enc) { return utf8dec(b64dec(rot13(enc))); }


// _p8 / av() obfuscation: reverse -> b64 -> byte-K9L -> b64 -> utf8
function obfDecode(s) {
    var e = b64dec(s.split("").reverse().join(""));
    var n = "";
    for (var i = 0; i < e.length; i++) n += String.fromCharCode(e.charCodeAt(i) - OBF_KEY[i % 3]);
    return utf8dec(b64dec(n));
}


function stripTags(s) {
    return s ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}


// Dean Edwards packer sembolu (base62'de A-Z)
function toBase(c, radix) {
    var ALNUM = "0123456789abcdefghijklmnopqrstuvwxyz";
    var head = c >= radix ? toBase(Math.floor(c / radix), radix) : "";
    var r = c % radix;
    return head + (r > 35 ? String.fromCharCode(r + 29) : ALNUM.charAt(r));
}


// eval(function(p,a,c,k,e,d){...}) govdesini cozer (turbo/fast oynaticilar)
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
        sym[s] = (c < kw.length && kw[c]) || s;
    }
    return payload.replace(/\b\w+\b/g, function (w0) {
        return sym.hasOwnProperty(w0) ? sym[w0] : w0;
    });
}


// sayfadaki tum packer bloklarini cozup birlestir
function packerTexts(h) {
    var out = "", pos = 0;
    while (true) {
        var st = h.indexOf("eval(function(p,a,c,k,e,d)", pos);
        if (st < 0) break;
        var em = h.indexOf(".split('|')))", st);
        var blk = em < 0 ? h.substring(st) : h.substring(st, em + 12);
        pos = st + 1;
        out += "\n" + unpackPacker(blk);
    }
    return out;
}


function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}


// ---------------- yerel playlist sunucusu ----------------
// Uygulamanin HLS yolu disaridan donen subtitles listesini yutuyor; altyazilar
// ayrica CF korumali (_di cookie'si embed sayfasindan geliyor) ve
// X-TIMESTAMP-MAP'siz oldugundan video ilk PTS'si kadar erken gosteriliyor.
// Cozum (dizilla/dizimag/filmmakinesi deseni): VTT'yi biz cekip map enjekte
// edip 127.0.0.1'den servis ederiz; master playlist'e SUBTITLES rendition'lari
// eklenip yine yerelden servis edilir.

var FH_SLOTS = {};

// video ilk PTS'si (ffprobe start_time=0.181 olculdu; bu encode ailesi dusuk PTS'li)
var FH_SUB_MPEGTS = 16290; // 0.181s * 90000

// idx -> tek govde servis eden yerel soket; donen URL "http://127.0.0.1:<port>/x.m3u8"
function fhServeSlot(idx, body) {
    var e = FH_SLOTS[idx];
    if (e) { e.body = body; return "http://127.0.0.1:" + e.port + "/x.m3u8"; }
    if (typeof Packages === "undefined") return null;
    try {
        var ss = new Packages.java.net.ServerSocket(0, 50, Packages.java.net.InetAddress.getByName("127.0.0.1"));
        var slot = { port: ss.getLocalPort(), body: body };
        FH_SLOTS[idx] = slot;
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
    } catch (e) { log("fhd yerel sunucu:", e); return null; }
}

// VTT basligina X-TIMESTAMP-MAP ekle -> cue'lar video PTS eksenine hizalanir
function fhInjectTsMap(vtt, mpegts) {
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
function fhSubPlaylist(srcUrl, dur) {
    var d = Math.ceil(dur || 7200);
    return "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:" + d +
        "\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
        "#EXTINF:" + d + ".000,\n" + srcUrl + "\n#EXT-X-ENDLIST\n";
}

// goreli URI'yi playlist base'ine gore mutlak yap (/me/..., /mz/... yollar)
function fhAbs(base, u) {
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
function fhSubLines(subs) {
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
function fhMasterWithSubs(master, base, subLines) {
    var lines = master.split("\n"), out = [], done = false;
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].replace(/\r$/, "");
        ln = ln.replace(/URI="([^"]*)"/g, function (m, u) {
            return u.indexOf("http") === 0 ? m : 'URI="' + fhAbs(base, u) + '"';
        });
        if (ln.indexOf("#EXT-X-STREAM-INF") === 0) {
            if (!done) { out = out.concat(subLines); done = true; }
            if (ln.indexOf("SUBTITLES=") < 0) ln += ',SUBTITLES="subs"';
        } else if (ln.length && ln.charAt(0) !== "#" && ln.indexOf("http") !== 0) {
            ln = fhAbs(base, ln);
        }
        out.push(ln);
    }
    return done ? out.join("\n") : null;
}

// playlist media ise sentetik master'a sarip subs grubunu baglar
function fhWrapMedia(playlistUrl, subLines) {
    return "#EXTM3U\n" + subLines.join("\n") +
        "\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,SUBTITLES=\"subs\"\n" + playlistUrl + "\n";
}

var provider = {
    name: "FullHDFilmizleSene (JS)",
    mainUrl: "https://www.fullhdfilmizlesene.now",
    lang: "tr",
    supportedTypes: ["Movie"],
    mainPage: [
    


    ],


    fixUrl: function (u) {
        if (!u) return u;
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("/") === 0) return this.mainUrl + u;
        return this.mainUrl + "/" + u;
    },


    // li.film karti: a.tt[href], span.film-title + span.kt, img[data-src], span.uhd, span.film-yil
    card: function (el, kind) {
        var a = sel(el, "a[href]")[0];
        if (!a) return null;
        var url = attr(a, "href");
        var img = sel(el, "img")[0];
        var src = img ? (attr(img, "data-src") || attr(img, "src")) : "";
        if (src && src.indexOf("data:") === 0) src = "";
        var year = null, quality = null;
        var t = txt(sel(el, "span.film-title")[0]);
        var k = txt(sel(el, "span.kt")[0]);
        var name = (t + (k ? " - " + k : "")).trim() || txt(a).replace(/\s*izle\s*$/i, "").trim();
        year = parseInt(txt(sel(el, "span.film-yil")[0])) || null;
        var q = txt(sel(el, "span.uhd")[0]);
        if (q) quality = q;
        return { name: name, url: url, posterUrl: this.fixUrl(src), year: year, quality: quality, type: "Movie" };
    },


    getMainPage: function (page, req) {
        var cfg = null;
        var mp = this.mainPage;
        for (var i = 0; i < mp.length; i++) if (mp[i].name === req.name) cfg = mp[i];
        if (!cfg) return { items: [], hasNext: false };
        var url = cfg.paging && page > 1 ? cfg.url + "/" + page : cfg.url;
        var d;
        try { d = doc(abs(url)); } catch (e) { return { items: [], hasNext: false }; }
        var out = sel(d, cfg.list);
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j], cfg.kind);
            if (c && c.name && c.url) list.push(c);
        }
        var maxP = page;
        var pls = sel(d, "a.sayfala");
        for (var x = 0; x < pls.length; x++) {
            var n = parseInt(re(attr(pls[x], "href"), "/(\\d+)/?$")) || 0;
            if (n > maxP) maxP = n;
        }
        return { items: [{ name: req.name, list: list, type: "Movie" }], hasNext: cfg.paging && maxP > page };
    },


    search: function (query) {
        var list = [];
        var r = getText(this.mainUrl + "/autocomplete/q.php?q=" + encodeURIComponent(query) + "&callback=", {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": this.mainUrl + "/"
        });
        var rows = null;
        try { rows = r ? JSON.parse(r) : null; } catch (e) { rows = null; }
        if (!rows) return list;
        for (var i = 0; i < rows.length; i++) {
            var it = rows[i];
            if (!it.dizilink) continue;
            var name = it.baslik + (it.altbaslik ? " - " + it.altbaslik : "");
            list.push({
                name: name,
                url: this.mainUrl + "/" + (it.prefix || "film") + "/" + it.dizilink + "/",
                posterUrl: it.vidresim || null,
                year: parseInt(it.yil) || null,
                quality: it.imdb ? "IMDB " + it.imdb : null,
                type: "Movie"
            });
        }
        return list;
    },


    // film sayfasindaki var scx = {...} blogunu cikarir
    extractScx: function (h) {
        var m = h.match(/var\s+scx\s*=\s*(\{.*?\});\s*<\/script>/);
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch (e) { return null; }
    },


    // scx -> embed listesi [{name, url, part}]
    scxEmbeds: function (scx) {
        var out = [];
        if (!scx) return out;
        var keys = [];
        for (var k in scx) keys.push(k);
        keys.sort(function (a, b) { return (scx[a].order || 0) - (scx[b].order || 0); });
        for (var i = 0; i < keys.length; i++) {
            var src = scx[keys[i]];
            var name = utf8dec(b64dec(src.tt || "")).trim();
            var sx = src.sx || {};
            var groups = ["t", "p"];
            for (var g = 0; g < groups.length; g++) {
                var arr = sx[groups[g]] || [];
                for (var j = 0; j < arr.length; j++) {
                    var url = scxDecode(arr[j]);
                    // "Fast Player" = turbo oynaticinin yeni adi; movie|watch/<id>
                    // baglantilari play sayfasina cevrilir
                    if (/turbo|fast/i.test(name)) {
                        var mm = url.match(/(?:movie|watch)\/([^/"']+)/);
                        if (mm) url = "https://turbo.imgz.me/play/" + mm[1];
                    }
                    if (url.indexOf("http") === 0) {
                        out.push({ name: name || groups[g], url: url, part: groups[g] === "t" ? null : j + 1 });
                    }
                }
            }
        }
        return out;
    },


    // embed sayfasi -> {stream, subs:[{lang,url}], poster}
    resolveEmbed: function (embed, filmUrl) {
        var h = getText(embed, { "Referer": filmUrl });
        if (!h) return null;
        var r = { stream: null, subs: [], poster: null };


        // varyant 1: /vx/ -> window._p8 obfuske JSON
        var m = h.match(/window\._p8='([^']+)'/);
        if (m) {
            try {
                var data = JSON.parse(obfDecode(m[1]));
                r.stream = data.cm || data.tm || null;
                r.poster = data.im || null;
                var ct = data.ct || [];
                for (var i = 0; i < ct.length; i++) {
                    if (ct[i].kind === "captions" && ct[i].file) {
                        r.subs.push({ lang: (ct[i].label || "Altyazi").trim(), url: ct[i].file });
                    }
                }
            } catch (e) { }
            if (r.stream) return r;
        }


        // varyant 2: /vod/ -> jwSetup.sources icinde av('...')
        var fm = h.match(/["']file["']\s*:\s*av\(['"]([^'"]+)['"]\)/);
        if (fm) {
            try { r.stream = obfDecode(fm[1]); } catch (e) { r.stream = null; }
            var tm = h.match(/jwSetup\.tracks\s*=\s*(\[.*?\]);/);
            if (tm) {
                try {
                    var tracks = JSON.parse(tm[1]);
                    for (var t = 0; t < tracks.length; t++) {
                        if (tracks[t].kind === "captions" && tracks[t].file) {
                            r.subs.push({ lang: (tracks[t].label || "Altyazi").trim(), url: tracks[t].file });
                        }
                    }
                } catch (e) { }
            }
            if (r.stream) return r;
        }


        // varyant 3: vidmoxy/fast sayfasi -> jwSetup.sources (JS'i sandbox'ta calistir)
        if (h.indexOf("jwSetup") !== -1 || h.indexOf("vidmoxy") !== -1) {
            var sf = this.sandboxJwSetup(h, embed);
            if (sf) { r.stream = sf; return r; }
        }

        // varyant 4: turbo/fast play sayfasi -> sources/file + packer cozumu
        var hay = h + "\n" + packerTexts(h);
        var sm = /["']?file["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/.exec(hay);
        if (sm) {
            r.stream = sm[1].replace(/\\\//g, "/");
            var tr = /["']?file["']?\s*:\s*["']([^"']+\.(?:vtt|srt)[^"']*)["']/g, tm3;
            while ((tm3 = tr.exec(hay))) {
                r.subs.push({ lang: "Altyazi", url: tm3[1].replace(/\\\//g, "/") });
            }
            var tt2 = /tracks\s*[:=]\s*(\[\s*\{[\s\S]*?\}\s*\])/.exec(hay);
            if (tt2) {
                try {
                    var ta = JSON.parse(tt2[1]);
                    for (var q = 0; q < ta.length; q++) {
                        if (ta[q] && ta[q].file && (!ta[q].kind || ta[q].kind === "captions")) {
                            r.subs.push({ lang: ta[q].label || "Altyazi", url: ta[q].file });
                        }
                    }
                } catch (e) { }
            }
            return r;
        }

        // genel fallback: sayfada duz m3u8 ara
        var g = h.match(/https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*/);
        if (g) { r.stream = g[0]; return r; }
        return r;
    },


    // vidmoxy/fast sayfasi: <script>'leri sahte DOM'da calistirip jwSetup.sources'u okur.
    // Ic eval'ler (packer) kendi kendini cozer; w()/_nx() zinciri sonunda file dolar.
    sandboxJwSetup: function (h, embedUrl) {
        try {
            if (typeof Function !== "function") return null;
            var scripts = [], m;
            var tagRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
            while ((m = tagRe.exec(h))) {
                var b = m[1];
                if (b && b.replace(/\s+/g, "")) scripts.push(b);
            }
            if (!scripts.length) return null;

            var hm = /^https?:\/\/([^\/:?#]+)/.exec(String(embedUrl || ""));
            var host = hm ? hm[1] : "";
            var href = String(embedUrl || "");

            var pre =
                "var __jw=null;" +
                "function __el(t){var e={style:{},dataset:{},innerHTML:'',_h:''," +
                "setAttribute:function(){},getAttribute:function(){return null}," +
                "addEventListener:function(){},removeEventListener:function(){},cloneNode:function(){return __el(t)}," +
                "insertAdjacentHTML:function(){},insertBefore:function(){},appendChild:function(){},removeChild:function(){},remove:function(){}," +
                "querySelector:function(){return null},querySelectorAll:function(){return[]},getElementsByTagName:function(){return[]}," +
                "classList:{add:function(){},remove:function(){},contains:function(){return false}},parentElement:null,focus:function(){},click:function(){}};" +
                "if(t==='a'){Object.defineProperty(e,'href',{set:function(v){var m=/^(https?:)\\/\\/([^\\/:?#]+)(\\/[^?#]*)?(.*)$/.exec(v)||[];" +
                "e.protocol=m[1]||'';e.hostname=m[2]||'';e.host=m[2]||'';e.pathname=m[3]||'/';e._h=v},get:function(){return e._h}});" +
                "e.protocol='';e.hostname='';e.host='';e.pathname='/'}return e}" +
                "var location={protocol:'https:',host:'" + host + "',hostname:'" + host + "',href:'" + href + "'," +
                "pathname:'/',search:'',hash:'',origin:'https://" + host + "',assign:function(){},replace:function(){},reload:function(){}};" +
                "var document={addEventListener:function(){},removeEventListener:function(){},getElementById:function(){return __el('div')}," +
                "createElement:function(t){return __el(t)},getElementsByTagName:function(){return[]},getElementsByClassName:function(){return[]}," +
                "querySelector:function(){return null},querySelectorAll:function(){return[]},write:function(){},writeln:function(){}," +
                "body:__el('b'),head:__el('h'),documentElement:__el('h'),cookie:'',referrer:'',readyState:'complete',location:location,domain:'" + host + "'};" +
                "var navigator={userAgent:'Mozilla/5.0',language:'tr',platform:'Win32',webdriver:false,plugins:[],mimeTypes:[]};" +
                "var screen={width:1920,height:1080,colorDepth:24};" +
                "var window={};window.location=location;window.document=document;window.navigator=navigator;window.screen=screen;" +
                "window.window=window;window.self=window;window.top=window;window.parent=window;window.frames=window;" +
                "window.addEventListener=function(){};window.removeEventListener=function(){};window.postMessage=function(){};" +
                "window.innerWidth=1920;window.innerHeight=1080;window.devicePixelRatio=1;window.open=function(){return __el('a')};" +
                "var self=window,top=window,parent=window,frames=window;" +
                "var localStorage={getItem:function(){return null},setItem:function(){},removeItem:function(){}};var sessionStorage=localStorage;" +
                "var console={log:function(){},warn:function(){},error:function(){},info:function(){},clear:function(){}};" +
                "function setTimeout(f){if(typeof f==='function'){try{f()}catch(e){}}return 0}function setInterval(){return 0}function clearTimeout(){}function clearInterval(){}" +
                "var Image=function(){return __el('img')};" +
                "var XMLHttpRequest=function(){return{open:function(){},send:function(){},setRequestHeader:function(){},readyState:4,status:200,responseText:''}};" +
                "var fetch=function(){return{then:function(){return this},catch:function(){return this}}};" +
                "var MutationObserver=function(){return{observe:function(){},disconnect:function(){},takeRecords:function(){return[]}}};" +
                "var IntersectionObserver=MutationObserver;var ResizeObserver=MutationObserver;" +
                "var requestAnimationFrame=function(){return 0};var cancelAnimationFrame=function(){};" +
                "var getComputedStyle=function(){return{getPropertyValue:function(){return''}}};" +
                "var matchMedia=function(){return{matches:false,media:'',addListener:function(){},addEventListener:function(){}}};" +
                "var Cookies={get:function(){return''},set:function(){},remove:function(){}};" +
                "var history={pushState:function(){},replaceState:function(){},length:1,state:null};" +
                "var URL=function(u){var e=__el('a');e.href=u;return e};" +
                "var atob=function(s){var T='" + B64 + "';var o='',b=0,n=0;s=String(s).replace(/[^A-Za-z0-9+\\/]/g,'');" +
                "for(var i=0;i<s.length;i++){var v=T.indexOf(s.charAt(i));if(v<0)continue;b=(b<<6)|v;n+=6;" +
                "if(n>=8){n-=8;o+=String.fromCharCode((b>>n)&255)}}return o};window.atob=atob;" +
                "var btoa=function(s){return s};" +
                "var jwplayer=function(){var p={};p.setup=function(c){__jw=c;return p};" +
                "var ks='on once off play pause seek setCurrentCaptions setCurrentAudioTrack remove resize getPlaylist getState getVolume setMute setFullscreen getFullscreen getContainer getConfig load playlistItem addButton removeButton trigger addCues setPlaybackRate setPip setControls setConfig attachMedia detachMedia'.split(' ');" +
                "for(var i=0;i<ks.length;i++){p[ks[i]]=function(){return p}}return p};" +
                "window.jwplayer=jwplayer;var jwSetup={};window.jwSetup=jwSetup;var jwpl=null;";

            var run =
                "for(var i=0;i<__S.length;i++){try{eval(__S[i])}catch(e){}}" +
                "try{if(jwSetup&&jwSetup.sources&&jwSetup.sources[0])return String(jwSetup.sources[0].file||'')}catch(e){}" +
                "try{if(__jw&&__jw.sources&&__jw.sources[0])return String(__jw.sources[0].file||'')}catch(e){}" +
                "try{if(__jw&&__jw.file)return String(__jw.file)}catch(e){}" +
                "return '';";

            var out = new Function("__S", pre + run)(scripts);
            return (out && out.indexOf("http") === 0) ? out : null;
        } catch (e) { return null; }
    },


    load: function (url) {
        var h = text(url);
        var rawTitle = re(h, 'property="og:title" content="([^"]+)"') || "Film";
        var yil = re(rawTitle, "(\\d{4})") || re(h, 'class="film-yil">\\s*(\\d{4})');
        var title = rawTitle.replace(/\s*Film izle\s*/i, " ").replace(/\s*izle\s*/i, " ").replace(/\s*\(\d{4}\)\s*$/, "").trim();
        var poster = re(h, 'property="og:image" content="([^"]+)"');
        var p2 = re(h, 'data-src="([^"]+)"[^>]*class="[^"]*ic-afis');
        if (p2) poster = p2;
        var oz = re(h, 'class="ozet-ic">(.*?)<\\/div>');
        var scx = this.extractScx(h);
        var kaynak = this.scxEmbeds(scx).length;
        return {
            name: title,
            url: url,
            type: "Movie",
            posterUrl: this.fixUrl(poster),
            plot: stripTags(oz) + (kaynak ? "" : "\n\n(Kaynak bulunamadi)"),
            year: parseInt(yil) || null,
            dataUrl: url,
            episodes: [{ data: url, name: "Film", season: 1, episode: 1 }]
        };
    },


    loadLinks: function (data) {
        var filmUrl = this.fixUrl(data);
        var links = [];
        var subs = [];
        var h;
        try { h = text(filmUrl); } catch (e) { h = null; }
        if (!h) return { links: links, subtitles: subs };


        var embeds = this.scxEmbeds(this.extractScx(h));
        for (var i = 0; i < embeds.length; i++) {
            var e = embeds[i];
            var tag = "FHDF " + e.name + (e.part ? " (" + e.part + ". Part)" : "");
            if (/youtube\.com|youtu\.be|dailymotion/.test(e.url)) {
                links.push({ url: e.url, name: tag, source: this.name, referer: filmUrl, type: "embed" });
                continue;
            }
            var r = null;
            try { r = this.resolveEmbed(e.url, filmUrl); } catch (ex) { r = null; }
            if (r && r.stream) {
                // altyazilari yerellestir: biz cekip map enjekte edip yerelden servis
                // ederiz (CF/cookie engelini atlar, erken-gelme sorununu cozer)
                for (var si = 0; si < r.subs.length; si++) {
                    var vtt = getText(r.subs[si].url, { "Referer": e.url });
                    if (vtt && vtt.indexOf("WEBVTT") >= 0) {
                        var vu = fhServeSlot("fhv" + i + "_" + si, fhInjectTsMap(vtt, FH_SUB_MPEGTS));
                        if (vu) r.subs[si]._local = vu;
                    }
                }
                // stream m3u8 ise SUBTITLES grubu eklenmis yerel master linki uret
                var localUrl = null;
                if (r.subs.length) {
                    var pl = getText(r.stream, { "Referer": e.url });
                    if (pl && pl.indexOf("#EXTM3U") >= 0) {
                        var localSubs = [], hasTr = false;
                        for (var s2 = 0; s2 < r.subs.length; s2++) {
                            if (/türk|turk|^tr/i.test(r.subs[s2].lang)) hasTr = true;
                        }
                        for (var s3 = 0; s3 < r.subs.length; s3++) {
                            var su2 = fhServeSlot("fhs" + i + "_" + s3,
                                fhSubPlaylist(r.subs[s3]._local || r.subs[s3].url, 7200));
                            if (su2) localSubs.push({
                                name: r.subs[s3].lang,
                                def: /türk|turk/i.test(r.subs[s3].lang) || (!hasTr && s3 === 0),
                                uri: su2
                            });
                        }
                        if (localSubs.length) {
                            var body = fhMasterWithSubs(pl, r.stream, fhSubLines(localSubs));
                            if (!body) body = fhWrapMedia(r.stream, fhSubLines(localSubs));
                            localUrl = fhServeSlot("fhm" + i, body);
                        }
                    }
                }
                if (localUrl) {
                    links.push({
                        url: localUrl,
                        name: tag + " (Altyazılı)",
                        source: this.name,
                        referer: e.url,
                        headers: { "Referer": e.url },
                        type: "hls"
                    });
                }
                links.push({
                    url: r.stream,
                    name: tag,
                    source: this.name,
                    referer: e.url,
                    headers: { "Referer": e.url },
                    type: "hls"
                });
                for (var s = 0; s < r.subs.length; s++) {
                    subs.push({ lang: r.subs[s].lang, url: r.subs[s]._local || r.subs[s].url });
                }
            } else {
                // cozulemeyen embed'i uygulamanin genel extractor'ina birak
                links.push({ url: e.url, name: tag, source: this.name, referer: filmUrl, type: "embed" });
            }
        }
        log("loadLinks:", filmUrl, "| embed:", embeds.length, "| link:", links.length, "| sub:", subs.length);
        return { links: links, subtitles: subs };
    }
};
