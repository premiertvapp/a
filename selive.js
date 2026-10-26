// ecanlitvizle.live kaynak eklentisi — canlı TV kanalları (THYTV "Canlı TV" bölümü).
// Yardımcılar: doc(url,headers?), text(url,headers?), post(url,form,headers?)->string,
//   http(url,{method,headers,data,body})->{code,url,text}, sel, txt, html, attr, re, abs, extractor, log
//
// Akış (uygulamanın LiveTvRepository/StreamRepository'ıyla aynı):
//   kategori sayfası -> ul.kanallar li a -> kanal slug'ı (data-url / href)
//   GET embed.php?kanal=<slug>[&yayin=N]&ulke=TR  (mobil UA + Referer)
//     -> file: '<idx>..|Xf|<obfuske url>'  -> karakter eşleme decode -> m3u8
//   decode: idx'den başlayarak SRC->DST dönüşümlü replace, baştaki 'x' atılır.


var SRC_CHARS = "€$ĂÄËĢḨĶḼŅŇŠȚŽӘЄБҖЧЖДӠФҒӶЫИКЉӨЎЊҺГŞ".split("");
var DST_CHARS = "0123456789.&=w?comaflihts:/rednkp_-".split("");


function ectlDecode(encoded) {
    var parts = encoded.split("|Xf|");
    if (parts.length < 2) return "";
    var value = parts[1];
    var idx = parseInt(parts[0].replace(/[^0-9]/g, "")) || 0;
    for (var i = 0; i < DST_CHARS.length; i++) {
        if (idx >= SRC_CHARS.length) idx = 0;
        value = value.split(SRC_CHARS[idx]).join(DST_CHARS[i]);
        idx++;
    }
    return value.replace(/^x/, "");
}


function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}


var MOBILE_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";


var provider = {
    name: "eCanliTvIzle (JS)",
    mainUrl: "https://www.ecanlitvizle.live",
    lang: "tr",
    supportedTypes: ["Live"],
    mainPage: [
        { name: "Popüler", url: "/category/genel-kanallar/" },
        { name: "Haber", url: "/category/haber-kanallari/" },
        { name: "Çocuk", url: "/category/cocuk-tv-kanallari/" },
        { name: "Müzik", url: "/category/muzik-tv-kanallari/" }
    ],


    card: function (el) {
        var a = el.tagName === "a" ? el : sel(el, "a[href]")[0];
        if (!a) return null;
        var nameEl = sel(a, "div.kanallaradi")[0];
        var img = sel(a, "div.kanallarlogo img")[0] || sel(a, "img")[0];
        var name = nameEl ? txt(nameEl) : (attr(a, "title") || txt(a));
        var kanal = nameEl ? attr(nameEl, "data-url") : null;
        if (!kanal) kanal = re(attr(a, "href"), "/([^/]+)/?$");
        if (!kanal) return null;
        var src = img ? (attr(img, "src") || attr(img, "data-src")) : "";
        return {
            name: name,
            url: attr(a, "href"),
            posterUrl: src || null,
            type: "Live",
            _k: kanal
        };
    },


    getMainPage: function (page, req) {
        var d;
        try { d = doc(abs(req.data)); } catch (e) { return { items: [], hasNext: false }; }
        var out = sel(d, "ul.kanallar li a");
        var list = [];
        var seen = {};
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.name && c.url && !seen[c.url]) {
                seen[c.url] = 1;
                delete c._k;
                list.push(c);
            }
        }
        return { items: [{ name: req.name, list: list, type: "Live" }], hasNext: false };
    },


    search: function (query) {
        var d;
        try { d = doc(abs("/canlitv")); } catch (e) { return []; }
        var q = query.toLowerCase();
        var out = sel(d, "ul.kanallar li a");
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.name && c.url && c.name.toLowerCase().indexOf(q) >= 0) {
                delete c._k;
                list.push(c);
            }
        }
        return list;
    },


    load: function (url) {
        var kanal = re(url, "/([^/]+)/?$");
        if (!kanal) return null;
        var d = null;
        try { d = doc(url); } catch (e) { }
        var name = d ? (txt(sel(d, "h1")[0]) || attr(sel(d, 'meta[property="og:title"]')[0], "content")) : kanal;
        var logo = d ? attr(sel(d, 'meta[property="og:image"]')[0], "content") : null;
        var data = JSON.stringify({ k: kanal, p: url, n: name || kanal });
        return {
            name: (name || kanal).replace(/\s*izle.*$/i, "").trim() || kanal,
            url: url,
            type: "Live",
            posterUrl: logo,
            plot: "Canlı TV — " + (name || kanal),
            dataUrl: data,
            episodes: [{ data: data, name: "Canlı Yayın", season: 1, episode: 1 }]
        };
    },


    // tek embed.php denemesi -> cozulmus m3u8
    extractStream: function (kanal, pageUrl, yayin) {
        var url = this.mainUrl + "/embed.php?kanal=" + kanal +
            (yayin ? "&yayin=" + yayin : "") + "&ulke=TR";
        var h = getText(url, {
            "User-Agent": MOBILE_UA,
            "Referer": pageUrl || this.mainUrl + "/" + kanal + "/"
        });
        if (!h) return null;
        var m = h.match(/file\s*:\s*'([^']+)'/);
        if (!m) return null;
        var dec = ectlDecode(m[1]);
        return dec.indexOf("http") === 0 ? dec : null;
    },


    loadLinks: function (data) {
        var links = [];
        var c = null;
        try { c = JSON.parse(data); } catch (e) { c = null; }
        var kanal = (c && c.k) || re(String(data), "/([^/]+)/?$");
        var pageUrl = c && c.p;
        var title = (c && c.n) || kanal;
        if (!kanal) return { links: links, subtitles: [] };


        var seen = {};
        var yayins = [0, 2, 3];
        for (var i = 0; i < yayins.length; i++) {
            var s;
            try { s = this.extractStream(kanal, pageUrl, yayins[i] || null); } catch (e) { s = null; }
            if (!s) continue;
            var key = s.split("?")[0];
            if (seen[key]) continue;
            seen[key] = 1;
            links.push({
                url: s,
                name: "ECTL " + title + (i === 0 ? "" : " S" + (i + 1)),
                source: this.name,
                referer: this.mainUrl + "/embed.php?kanal=" + kanal,
                headers: { "Referer": this.mainUrl + "/" },
                type: "hls",
                isM3u8: true
            });
        }
        log("loadLinks:", kanal, "| link:", links.length);
        return { links: links, subtitles: [] };
    }
};
