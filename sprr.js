// Spor TV — PapazSports + CanliKolik birlesik kanal listesi (tek bolum).
// Yardimcilar: doc(url), text(url), sel(el,css), txt(el), attr(el,"..."), re(str,regex),
//              abs(url), post(url, form, headers), extractor(url), log(...)
//
// Davranis: iki sitenin kanallari isim normalizasyonuyla ("BEIN SPORTS 1" ==
// "beinsports 1") eslesir, kart tek gorunur. Tiklaninca her iki sitedeki yayin
// da cozulur; ilk bulunan once, digeri yedek kaynak olarak links'e eklenir.
//
// Domain ayarlari tek yerden:
//   PAPAZ_HOSTS : ayni altyapidaki site listesi (ilk calisan kullanilir)
//   CK_HOSTS    : canlikolikNN.live yedek domain listesi (ilk calisan kullanilir)
//
// PapazSports zinciri : li[data-url] -> POST auth.php {channel:id} -> {URL,TOKEN,SERVER}
// CanliKolik zinciri  : getstream.php?macid -> iframe.php -> iframe2.php?url=<m3u8>

var PAPAZ_HOSTS = [
    "https://www.sporcafe74.top",
    "https://www.inattvizle496.top",
    "https://www.trgoals183.top",
    "https://www.papazsports1031.pro"
];
var CK_HOSTS = ["https://canlikolik22.live", "https://canlikolik66.live"];

var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function postForm(url, params, referer) {
    var headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer + "/",
        "Origin": referer
    };
    try { return JSON.parse(post(url, params, headers)); } catch (e) { log("auth hata:", e); return null; }
}

var provider = {
    name: "Spor TV (JS)",
    mainUrl: PAPAZ_HOSTS[0],
    lang: "tr",
    supportedTypes: ["Live"],
    mainPage: [
        { name: "Spor TV", url: "/" }
    ],

    _ckBase: null,
    _pzBase: null,
    _pzSiteNames: null,

    // host'un phptojs.site_name degeri -> stream 'pl' header'i (host basina cache)
    pzSiteName: function (host) {
        var cache = this._pzSiteNames || (this._pzSiteNames = {});
        if (cache[host]) return cache[host];
        var h = "";
        try { h = String(text(host + "/") || ""); } catch (e) { h = ""; }
        cache[host] = re(h, "site_name':'([^']+)'") || "PapazSports";
        return cache[host];
    },

    // "BEIN SPORTS 1" / "beinsports 1" -> "beinsports1" (eslesme anahtari)
    normName: function (s) {
        return String(s || "").toLowerCase()
            .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
            .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
            .replace(/[^a-z0-9]/g, "");
    },

    // iki sitenin farkli yazdigi kanal adlarini tek kanonik forma indirger:
    //   pz "beIN 1"/"beIN Max 1"    vs ck "beinsports 1"/"beinsports max 1"
    //   pz "SMARTSPOR 1"            vs ck "spor smart 2"
    //   pz "TRT Yıldız"             vs ck "trt spor yildiz"
    canon: function (key) {
        key = key.replace(/^bein(?!sports)/, "beinsports");
        key = key.replace(/^sporsmart/, "smartspor");
        var alias = { "trtsporyildiz": "trtyildiz" };
        return alias[key] || key;
    },

    // ===================== kaynak okuma =====================

    // PAPAZ_HOSTS icinde gercek kanal listesi donen ilk hostu bulur
    // (_pzBase'den baslar), _pzBase/mainUrl'i gunceller, doc'u dondurur.
    pzDoc: function () {
        var start = 0;
        if (this._pzBase) {
            var ix = PAPAZ_HOSTS.indexOf(this._pzBase);
            if (ix >= 0) start = ix;
        }
        for (var i = 0; i < PAPAZ_HOSTS.length; i++) {
            var host = PAPAZ_HOSTS[(start + i) % PAPAZ_HOSTS.length];
            var d = null;
            try { d = doc(host + "/"); } catch (e) { d = null; }
            if (!d) continue;
            if (!sel(d, "#tv-listesi .match-list li").length) continue;
            this._pzBase = host; this.mainUrl = host;
            return d;
        }
        return null;
    },

    // PapazSports kanal kartlari: #tv-listesi .match-list li
    // data-url="#hash", data-name, img[src]
    pzChannels: function () {
        var out = [];
        var d = this.pzDoc();
        if (!d) return out;
        var lis = sel(d, "#tv-listesi .match-list li");
        for (var i = 0; i < lis.length; i++) {
            var el = lis[i];
            var img = sel(el, "img")[0];
            var name = attr(el, "data-name") || (img ? attr(img, "alt") : "");
            var hash = String(attr(el, "data-url") || "");
            if (hash.indexOf("#") === 0) hash = hash.substring(1);
            if (!name || !hash) continue;
            out.push({
                name: name,
                logo: img ? this.fixUrl(attr(img, "src")) : "",
                pzHash: hash,
                tip: attr(el, "data-target") || "viptv",
                src: attr(el, "data-source") || "",
                search: attr(el, "data-search") || name
            });
        }
        return out;
    },

    // CanliKolik kanal kartlari: div.matchTabsItem.tvizle -> a.tvizle[data-attr]
    ckChannels: function () {
        var start = 0;
        if (this._ckBase) {
            var ix = CK_HOSTS.indexOf(this._ckBase);
            if (ix >= 0) start = ix;
        }
        for (var i = 0; i < CK_HOSTS.length; i++) {
            var host = CK_HOSTS[(start + i) % CK_HOSTS.length];
            var d = null;
            try { d = doc(host + "/"); } catch (e) { d = null; }
            if (!d) continue;
            var items = sel(d, ".matchTabsItem");
            var out = [];
            for (var j = 0; j < items.length; j++) {
                var el = items[j];
                if ((attr(el, "class") || "").indexOf("tvizle") === -1) continue;
                var a = sel(el, "a.tvizle")[0];
                var id = a ? String(attr(a, "data-attr") || "").trim() : "";
                if (!id) continue;
                var nm = sel(el, ".matchDetails a")[0];
                var name = nm ? txt(nm).replace(/\s+/g, " ").trim() : "";
                if (!name) name = String(attr(a, "data-kanal") || "").trim() || ("Kanal " + id);
                var im = sel(el, "img.tvlogo")[0];
                out.push({ id: id, name: name, logo: im ? this.ckAbs(attr(im, "src"), host) : "" });
            }
            if (out.length) { this._ckBase = host; return out; }
        }
        return [];
    },

    ckAbs: function (u, host) {
        u = String(u || "").trim();
        if (!u) return "";
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        var b = host || this._ckBase || CK_HOSTS[0];
        if (u.indexOf("/") === 0) return b + u;
        return b + "/" + u;
    },

    fixUrl: function (u) {
        if (!u) return u;
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("/") === 0) return this.mainUrl + u;
        return u;
    },

    // ===================== birlesik liste =====================

    // Iki kaynagi isim uzerinden birlestirir; papaz sirasi korunur,
    // sadece canlikolik'te olanlar sona eklenir.
    merged: function () {
        var out = [];
        var byKey = {};
        var pz = this.pzChannels();
        for (var i = 0; i < pz.length; i++) {
            var c = {
                name: pz[i].name, logo: pz[i].logo,
                pzHash: pz[i].pzHash, tip: pz[i].tip, src: pz[i].src,
                search: pz[i].search, ckId: ""
            };
            out.push(c);
            var k = this.canon(this.normName(c.name));
            if (!byKey[k]) byKey[k] = c;
        }
        var ck = this.ckChannels();
        for (var j = 0; j < ck.length; j++) {
            var key = this.canon(this.normName(ck[j].name));
            // ck'de numarasiz gelen kanallar ("s sport" = ssport1 gibi) icin +1 dene
            var m = byKey[key] || byKey[key + "1"];
            if (m) {
                m.ckId = ck[j].id;
                if (!m.logo) m.logo = ck[j].logo;
            } else {
                var c2 = {
                    name: ck[j].name, logo: ck[j].logo,
                    pzHash: "", tip: "", src: "", search: ck[j].name, ckId: ck[j].id
                };
                out.push(c2);
                byKey[key] = c2;
            }
        }
        return out;
    },

    // card url: <mainUrl>/#s:<pzHash>:<ckId>  (bos taraf "-" olur)
    cardUrl: function (m) {
        return this.mainUrl + "/#s:" + (m.pzHash || "-") + ":" + (m.ckId || "-");
    },

    toCard: function (m) {
        return { name: m.name, url: this.cardUrl(m), posterUrl: m.logo, type: "Live" };
    },

    // ===================== yayin cozumleme =====================

    pzLink: function (ad, tip, link) {
        var links = [];
        var linkName = "PapazSports " + (ad || "HD");
        if (tip === "vip" || tip === "viptv") {
            var params = tip === "vip" ? { id: String(link) } : { channel: String(link) };
            var start = 0;
            if (this._pzBase) {
                var ix = PAPAZ_HOSTS.indexOf(this._pzBase);
                if (ix >= 0) start = ix;
            }
            // auth.php yanit veren ilk host kazanir; site degisirse pl/referer da ona gore
            for (var h = 0; h < PAPAZ_HOSTS.length; h++) {
                var host = PAPAZ_HOSTS[(start + h) % PAPAZ_HOSTS.length];
                var ret = postForm(host + "/auth.php", params, host);
                if (!ret || !ret.URL) continue;
                this._pzBase = host; this.mainUrl = host;
                links.push({
                    url: ret.URL,
                    name: linkName + (ret.SERVER ? " S" + (ret.SERVER + 1) : ""),
                    source: this.name,
                    referer: host + "/",
                    quality: ad === "HD" ? 1080 : 720,
                    headers: {
                        "usertoken": ret.TOKEN || "",
                        "pl": this.pzSiteName(host),
                        "Referer": host + "/",
                        "Origin": host,
                        "User-Agent": UA
                    },
                    isM3u8: true,
                    type: "hls"
                });
                break;
            }
        } else if (tip === "m3u8") {
            links.push({
                url: link, name: linkName, source: this.name,
                referer: this.mainUrl + "/", quality: 720,
                headers: { "Referer": this.mainUrl + "/", "User-Agent": UA },
                isM3u8: true, type: "hls"
            });
        } else if (tip === "frame") {
            var merged = false;
            try {
                var r = extractor(link);
                if (r && r.links) {
                    for (var k = 0; k < r.links.length; k++) links.push(r.links[k]);
                    merged = r.links.length > 0;
                }
            } catch (e) { }
            if (!merged) links.push({ url: link, name: linkName, source: this.name, referer: this.mainUrl + "/" });
        }
        return links;
    },

    ckLink: function (id) {
        var links = [];
        var start = 0;
        if (this._ckBase) {
            var ix = CK_HOSTS.indexOf(this._ckBase);
            if (ix >= 0) start = ix;
        }
        var m3u8 = "", embed = "", used = null;
        for (var h = 0; h < CK_HOSTS.length; h++) {
            var host = CK_HOSTS[(start + h) % CK_HOSTS.length];
            var ara = "";
            try { ara = String(text(host + "/getstream.php?macid=" + id) || "").trim(); } catch (e) { ara = ""; }
            if (!ara) continue;
            used = host;
            if (ara.indexOf("http") === 0) embed = ara;
            if (ara.indexOf(".m3u8") !== -1) {
                m3u8 = ara;
            } else if (ara.indexOf(".php") !== -1) {
                var body = "";
                try { body = text(this.ckAbs(ara, host)) || ""; } catch (e) { body = ""; }
                var m = re(body, "iframe2\\.php\\?url=([^&\"']+)");
                if (!m) m = re(body, "(https?://[^\"'\\s]+\\.m3u8[^\"'\\s]*)");
                if (m) {
                    m3u8 = (m.indexOf("http") === 0) ? m : decodeURIComponent(m);
                    embed = host + "/iframe2.php?url=" + m3u8 + "&id=" + id;
                }
            }
            if (m3u8.indexOf("http") === 0) break;
            m3u8 = "";
        }
        if (used && m3u8.indexOf("http") === 0) {
            links.push({
                url: m3u8,
                name: "CanliKolik HD",
                source: this.name,
                referer: embed || (used + "/"),
                quality: 720,
                headers: {
                    "Referer": embed || (used + "/"),
                    "Origin": used,
                    "User-Agent": UA
                },
                isM3u8: true,
                type: "hls"
            });
        }
        return links;
    },

    // ===================== ortak API =====================

    getMainPage: function (page, req) {
        var list = [];
        var ms = this.merged();
        for (var i = 0; i < ms.length; i++) list.push(this.toCard(ms[i]));
        return { items: [{ name: req.name, list: list, type: "Live" }], hasNext: false };
    },

    search: function (query) {
        var q = String(query || "").toLowerCase();
        var list = [];
        var ms = this.merged();
        for (var i = 0; i < ms.length; i++) {
            if ((ms[i].search || ms[i].name).toLowerCase().indexOf(q) === -1) continue;
            list.push(this.toCard(ms[i]));
        }
        return list;
    },

    load: function (url) {
        // "#s:<pzHash>:<ckId>" geri coz
        var h = re(String(url), "#s:(.*)$") || "";
        var ix = h.lastIndexOf(":");
        var pzHash = ix >= 0 ? h.substring(0, ix) : h;
        var ckId = ix >= 0 ? h.substring(ix + 1) : "";
        if (pzHash === "-") pzHash = "";
        if (ckId === "-") ckId = "";

        var name = "Canli Yayin", poster = "", plot = "";
        var tip = "", src = "";

        if (pzHash) {
            // papaz karti: isim + yayin parametreleri (data-target/data-source)
            var d = this.pzDoc();
            var lis = d ? sel(d, "#tv-listesi .match-list li") : [];
            for (var i = 0; i < lis.length; i++) {
                var el = lis[i];
                var du = String(attr(el, "data-url") || "");
                if (du.indexOf("#") === 0) du = du.substring(1);
                if (du !== pzHash) continue;
                var img = sel(el, "img")[0];
                name = (attr(el, "data-title") || attr(el, "data-name") || name)
                    .split(" Canlı İzle")[0];
                poster = img ? this.fixUrl(attr(img, "src")) : poster;
                plot = attr(el, "data-search") || name;
                tip = attr(el, "data-target") || "viptv";
                src = attr(el, "data-source") || "";
                break;
            }
        }
        if ((!poster || name === "Canli Yayin") && ckId) {
            var chs = this.ckChannels();
            for (var k = 0; k < chs.length; k++) {
                if (chs[k].id === ckId) {
                    if (name === "Canli Yayin") name = chs[k].name;
                    if (!poster) poster = chs[k].logo;
                    break;
                }
            }
        }

        var data = JSON.stringify({ pz: tip ? { ad: "HD", tip: tip, link: src } : null, ck: ckId || null });
        return {
            name: name,
            url: url,
            type: "Live",
            posterUrl: poster,
            plot: plot || name,
            dataUrl: data,
            episodes: [{ data: data, name: "Canli Yayin", season: 1, episode: 1 }]
        };
    },

    loadLinks: function (data) {
        var p = null;
        try { p = JSON.parse(data); } catch (e) { p = null; }
        if (!p) return { links: [], subtitles: [] };

        // iki kaynagi da coz; ilk cozulen once, digeri yedek
        var pzLinks = (p.pz && p.pz.link) ? this.pzLink(p.pz.ad, p.pz.tip, p.pz.link) : [];
        var ckLinks = p.ck ? this.ckLink(p.ck) : [];
        return { links: pzLinks.concat(ckLinks), subtitles: [] };
    }
};
