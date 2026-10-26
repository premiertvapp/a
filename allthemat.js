// beyazelma78.com + CanliTribun + Slotin TV birlesik mac eklentisi.
// Yardimcilar: doc(url), text(url), post(url,form,headers), http(url,{method,headers})->{code,url,text},
//   sel(el,css), txt(el), attr(el,"href"), re(str,regex), abs(url), extractor(url), log(...)
//
// Bolum basina TEK kategori: uc sitenin maclari ayni satirda birlesir (takim cifti dedup).
// Tiklaninca: mac hangi sitelerde varsa hepsinin yayinlari "kaynak" olarak oynatıcıya gider.
//
// Zincirler:
//   beyazelma : / flight "today":[{slug,homeTeam,awayTeam,kickoffIstanbul,league,isLive,...}]
//               mac -> /kanal/<slug> -> /api/embed?u=<tok> -> "slug":"tr-..-hd"
//               -> embed.beyazelma78.com/api/play/<slug> -> {primary,fallbacks[]} m3u8
//   canlitribun: ahatm12od.top/domain_list.json -> canli domain ->
//               ana sayfa .futbol_kategori (ilk tahmin_yok = Popüler) a.index-mac.yayin
//               mac -> .yayin_kaynak{data-target=vip|viptv|m3u8|frame,data-src}
//               vip/viptv -> POST /auth.php {id|channel} -> {URL,TOKEN,SERVER} m3u8
//   slotin    : data-reality.com/matches.php a.single-match (.date spor, .event lig,
//               .home/.away takimlar) -> channel?id=<id> -> domain.php -> <id>/mono.m3u8
//   justintv  : gr0k.app/script2.js "karsilasmalar"[{title,league,time,url=/event.html?id=..}]
//               -> yalnizca Barcelona - Real Madrid -> event.html baseurls[] -> <id>.m3u8

var BE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BE_EMBED = "https://embed.beyazelma78.com"; // yedek — embHost() cozulmus domain'den uretir

// takim adini ascii-slug'a cevirir (karsilastirma icin)
function slugifyBe(s) {
    var di = { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u" };
    s = String(s || "").toLowerCase();
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        out += di[c] || (/[a-z0-9]/.test(c) ? c : "-");
    }
    return out.replace(/-+/g, "-").replace(/^-|-$/g, "");
}
// kulup ekleri (fk/sk/bb/spor...) eslestirmede atilir: "Erzurumspor FK" == "Erzurumspor"
var BE_TEAM_DROP = {
    fk: 1, fc: 1, sk: 1, gsk: 1, bsk: 1, cf: 1, ac: 1, sc: 1, afc: 1, ssc: 1, ssd: 1,
    ud: 1, cd: 1, sd: 1, ca: 1, rc: 1, rcd: 1, ec: 1, as: 1, us: 1, bb: 1, bk: 1, hk: 1, jk: 1,
    if: 1, ik: 1, aik: 1, ifk: 1, ff: 1, sv: 1, bv: 1, vfl: 1, vfb: 1, tsv: 1, fsv: 1,
    spor: 1, kulubu: 1, futbol: 1, belediyespor: 1
};
function teamKey(s) {
    var sl = slugifyBe(s);
    var t = sl.split("-"), kept = [];
    for (var i = 0; i < t.length; i++) {
        var w = t[i];
        if (w.length === 1 || BE_TEAM_DROP[w]) continue; // "A.Ş." -> a-s gibi kisaltma parcalari
        if (w.length > 6 && w.slice(-4) === "spor") w = w.slice(0, -4); // "erzurumspor" -> "erzurum"
        if (w) kept.push(w);
    }
    return kept.length ? kept.join("-") : sl;
}
function pairKey(home, away) { return teamKey(home) + "|" + teamKey(away); }

// El Clasico her zaman listenin basinda gorunur
var BE_EL = { "barcelona|real-madrid": 1, "real-madrid|barcelona": 1 };

// ---------------- flight payload cozucu (beyazelma) ----------------

function beFlight(h) {
    var u = "", m;
    var rx = /__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
    while ((m = rx.exec(h))) u += m[1];
    return u.replace(/\\(u[0-9a-fA-F]{4}|.)/g, function (mm, g) {
        if (g.charAt(0) === "u") return String.fromCharCode(parseInt(g.substring(1), 16));
        if (g === "n") return " ";
        return g;
    });
}

function beBalanced(u, j) {
    var d = 0, ins = false, esc = false;
    for (var k = j; k < u.length; k++) {
        var c = u.charAt(k);
        if (ins) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') ins = false;
            continue;
        }
        if (c === '"') { ins = true; continue; }
        if (c === '{' || c === '[') d++;
        else if (c === '}' || c === ']') {
            d--;
            if (d === 0) return k + 1;
        }
    }
    return -1;
}

function beArr(u, key) {
    var rx = new RegExp('"' + key + '"\\s*:', "g"), m;
    while ((m = rx.exec(u))) {
        var j = m.index + m[0].length;
        while (u.charAt(j) === " ") j++;
        if (u.charAt(j) !== "[") continue;
        var end = beBalanced(u, j);
        if (end < 0) continue;
        try { return JSON.parse(u.substring(j, end)); } catch (e) { }
    }
    return null;
}

// js icinde "key = [ ... ]" seklinde tanimli diziyi bulur (karsilasmalar gibi)
function jtArr(js, key) {
    var i = js.indexOf(key);
    while (i !== -1) {
        var j = js.indexOf("[", i + key.length);
        if (j === -1) return null;
        if (!/^[\s=:]*$/.test(js.substring(i + key.length, j))) { i = js.indexOf(key, i + 1); continue; }
        var end = beBalanced(js, j);
        if (end < 0) return null;
        try { return JSON.parse(js.substring(j, end).replace(/,\s*([}\]])/g, "$1")); } catch (e) { return null; }
    }
    return null;
}

function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}

// ---------------- canlitribun domain + post ----------------

var CT_UA = BE_UA;

// ahatm12od.top/domain_list.json -> {"1":"www.canlitribunNNN.top",...} ilk gecerli
function ctMainUrl() {
    var c = provider._ctUrl;
    if (c && (new Date().getTime() - c.t) < 3600000) return c.u;
    var u = null;
    try {
        var j = JSON.parse(getText("https://ahatm12od.top/domain_list.json") || "{}");
        var keys = Object.keys(j).sort(function (a, b) { return (+a) - (+b); });
        for (var i = 0; i < keys.length; i++) {
            var host = String(j[keys[i]] || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
            if (host) { u = "https://" + host; break; }
        }
    } catch (e) { log("ct domain_list:", e); }
    if (u) provider._ctUrl = { t: new Date().getTime(), u: u };
    return u;
}

function ctPost(url, params) {
    try {
        var r = post(url, params, {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": (ctMainUrl() || "") + "/",
            "Origin": ctMainUrl() || ""
        });
        return JSON.parse(r);
    } catch (e) { return null; }
}

var provider = {
    name: "BeyazElma Maçlar (JS)",
    // elmacibaba.com guncel siteye yonlendirir; sayacli beyazelmaNN.com da denenir
    mainUrl: "https://beyazelma78.com",
    lang: "tr",
    supportedTypes: ["Sport"],
    // Lig bolumleri — canlitribun ile ayni adlar; La Liga ilk sirada (El Clasico onceligi)
    mainPage: [
        { name: "İspanya La Liga", url: "/", lg: "laliga" },
        { name: "Spor Toto Süper Lig", url: "/", lg: "super" },
        { name: "İngiltere Premier Lig", url: "/", lg: "premier" },
        { name: "Fransa Ligue 1", url: "/", lg: "ligue1" }
    ],
    logoUrl: "https://vd.mackolik.com",

    // justintvturkiye-gercek.net — mac listesi gr0k.app/script2.js icinde
    jtBase: "https://justintvturkiye-gercek.net",

    slotin: {
        mainUrl: "",
        dataUrl: "",
        matchesUrl: "",
        list: "a.single-match"
    },

    fixUrl: function (u) {
        if (!u) return u;
        u = String(u);
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        if (u.indexOf("/") === 0) return this.beBase() + u;
        return this.beBase() + "/" + u;
    },

    // guncel beyazelma domain'i: elmacibaba.com yonlendirmesi -> sayacli domainler
    // 200 + __next_f veren ilk aday 10 dk cache'lenir
    beBase: function () {
        var c = this._base;
        if (c && (new Date().getTime() - c.t) < 600000) return c.u;
        var cands = ["https://elmacibaba.com", this.mainUrl];
        var m = /beyazelma(\d+)\./.exec(this.mainUrl);
        if (m) for (var n = 1; n <= 6; n++) cands.push("https://beyazelma" + (+m[1] + n) + ".com");
        var u = null;
        for (var i = 0; i < cands.length && !u; i++) {
            try {
                var r = http(cands[i] + "/", { method: "GET", headers: { "User-Agent": BE_UA } });
                if (r && r.code === 200 && r.text && r.text.indexOf("__next_f") !== -1) {
                    u = String(r.url || cands[i]).replace(/\/+$/, "");
                }
            } catch (e) { }
        }
        if (!u) u = this.mainUrl;
        this._base = { t: new Date().getTime(), u: u };
        return u;
    },

    // embed host = embed.<cozulmus-domain>; sayfadaki EMBED_ORIGIN varsa o kullanilir
    embHost: function () {
        var h = re(this.beBase(), "https?://([^/]+)") || "";
        return h ? "https://embed." + h.replace(/^www\./, "") : BE_EMBED;
    },

    img: function (u) {
        if (!u) return null;
        if (u.indexOf("http") === 0) return u;
        return this.beBase() + u;
    },

    // lig metnini bolum anahtarina cevirir (uc sitede farkli yazimlar ayni lige duser)
    lgKey: function (s) {
        s = String(s || "").toLowerCase();
        if (s.indexOf("süper lig") !== -1 || s.indexOf("super lig") !== -1) return "super";
        if (s.indexOf("premier") !== -1) return "premier";
        if (s.indexOf("la liga") !== -1 || s.indexOf("laliga") !== -1) return "laliga";
        if (s.indexOf("ligue 1") !== -1 || s.indexOf("ligue1") !== -1) return "ligue1";
        return "";
    },

    // mackolik livedata (bugun+yarin) -> {"s:<evSlug>-<depSlug>":{home,away}} logo haritasi
    logoMap: function () {
        var c = this._logos;
        if (c && (new Date().getTime() - c.t) < 300000) return c.m;
        var map = {};
        var put = function (key, homeId, awayId) {
            if (!key || (!homeId && !awayId)) return;
            map[key] = {
                home: homeId ? "https://im.mackolik.com/img/logo/buyuk/" + homeId + ".gif" : null,
                away: awayId ? "https://im.mackolik.com/img/logo/buyuk/" + awayId + ".gif" : null
            };
        };
        for (var d = 0; d < 2; d++) {
            var t = new Date(Date.now() + d * 864e5);
            var stamp = ("0" + t.getDate()).slice(-2) + "/" +
                ("0" + (t.getMonth() + 1)).slice(-2) + "/" + t.getFullYear();
            var j = null;
            try { j = JSON.parse(getText(this.logoUrl + "/livedata?date=" + stamp, { "User-Agent": BE_UA }) || "{}"); }
            catch (e) { log("livedata:", e); }
            var rows = (j && j.m) || [];
            for (var i = 0; i < rows.length; i++) {
                var m = rows[i];
                if (!m) continue;
                var slug = teamKey(m[2]) + "-" + teamKey(m[4]);
                if (slug !== "-") put("s:" + slug, m[1], m[3]);
            }
            var ev = (j && j.e) || [];
            for (var k = 0; k < ev.length; k++) {
                var e = ev[k];
                if (!e) continue;
                var eslug = teamKey(e[8]) + "-" + teamKey(e[10]);
                if (eslug !== "-") put("s:" + eslug, e[7], e[9]);
            }
        }
        this._logos = { t: new Date().getTime(), m: map };
        return map;
    },

    // ---------------- kaynak kartlari ----------------

    // beyazelma "today" -> kartlar {pk,home,away,name,url,poster,posterAway,plot,be:m}
    beCards: function () {
        var c = this._be;
        if (c && (new Date().getTime() - c.t) < 180000) return c.a;
        var h = getText(this.beBase() + "/", { "User-Agent": BE_UA });
        var arr = h ? beArr(beFlight(h), "today") : null;
        var out = [];
        // yalnizca bugunun maclari (Istanbul takvimi, UTC+3)
        var todayTr = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
        for (var i = 0; arr && i < arr.length; i++) {
            var m = arr[i];
            if (!m || !m.slug) continue;
            if (m.date) {
                var md = new Date(m.date);
                var mTr = new Date(md.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
                if (mTr !== todayTr) continue;
            }
            var home = m.homeTeam && m.homeTeam.name || "";
            var away = m.awayTeam && m.awayTeam.name || "";
            var name = (home || m.title || "") + (away ? " - " + away : "");
            if (!name.trim()) name = m.title || m.slug || "Maç";
            var t = m.isLive ? "CANLI" : (m.kickoffIstanbul || "");
            out.push({
                pk: pairKey(home, away),
                home: home, away: away, league: m.league || "",
                name: name + (t ? " (" + t + ")" : ""),
                url: this.fixUrl("/mac/" + m.slug),
                posterUrl: this.img(m.homeTeam && m.homeTeam.logo),
                posterAwayUrl: this.img(m.awayTeam && m.awayTeam.logo),
                plot: [m.league, m.channelName || m.tvChannel].filter(Boolean).join(" | "),
                be: m
            });
        }
        this._be = { t: new Date().getTime(), a: out };
        return out;
    },

    // slotin satiri -> kart
    slotinTxt: function (el, css) {
        var n = sel(el, css)[0];
        return n ? txt(n) : "";
    },
    slotinLeague: function (el) {
        var e = this.slotinTxt(el, ".event");
        var i = e.lastIndexOf("|");
        return (i === -1 ? e : e.substring(i + 1)).trim();
    },
    slotinCards: function () {
        var c = this._sl;
        if (c && (new Date().getTime() - c.t) < 180000) return c.a;
        var out = [];
        try {
            var sels = sel(doc(this.slotin.matchesUrl), this.slotin.list);
            for (var i = 0; sels && i < sels.length; i++) {
                var el = sels[i];
                var home = this.slotinTxt(el, ".home");
                var away = this.slotinTxt(el, ".away");
                var id = re(attr(el, "href") || "", "[?&]id=([^&]+)");
                if (!id || !home) continue;
                var ev = this.slotinTxt(el, ".event");
                var imgs = sel(el, "img");
                out.push({
                    pk: pairKey(home, away),
                    home: home, away: away, league: this.slotinLeague(el),
                    name: (away ? home + " - " + away : home) + " (" + (re(ev, "(\\d{2}:\\d{2})") || "") + ")",
                    url: this.slotin.mainUrl + "/" + attr(el, "href"),
                    posterUrl: imgs.length ? attr(imgs[0], "src") : null,
                    posterAwayUrl: imgs.length > 1 ? attr(imgs[imgs.length - 1], "src") : null,
                    plot: (this.slotinTxt(el, ".date") + " | " + ev).trim(),
                    sl: id
                });
            }
        } catch (e) { log("slotin liste:", e); }
        this._sl = { t: new Date().getTime(), a: out };
        return out;
    },

    // canlitribun populer maclari -> kartlar
    ctCards: function () {
        var c = this._ct;
        if (c && (new Date().getTime() - c.t) < 180000) return c.a;
        var out = [];
        var base = ctMainUrl();
        if (base) {
            try {
                var d = doc(base + "/");
                var els = sel(d, ".futbol_kategori .tahmin_yok, .futbol_kategori a.index-mac");
                var inPop = false, seenLabel = false;
                for (var i = 0; i < els.length; i++) {
                    var el = els[i];
                    var cls = attr(el, "class") || "";
                    if (cls.indexOf("tahmin_yok") !== -1) {
                        if (seenLabel) break;
                        seenLabel = true; inPop = true; continue;
                    }
                    if (!inPop || cls.indexOf("yayin") === -1) continue;
                    var title = (attr(el, "title") || "").split(" Canlı İzle")[0];
                    var parts = title.split(/\s+-\s+/);
                    var home = parts[0] || "", away = parts[1] || "";
                    var sm = re(cls, "start-([0-9]+-[0-9]+)");
                    var href = attr(el, "href") || "";
                    out.push({
                        pk: pairKey(home, away),
                        home: home, away: away, league: txt(sel(el, ".name span")[0]) || "",
                        name: title + (sm ? " (" + sm.replace("-", ":") + ")" : ""),
                        url: this.fixUrl(href.indexOf("http") === 0 ? href : base + "/" + href.replace(/^\/+/, "")),
                        ct: true
                    });
                }
            } catch (e) { log("ct liste:", e); }
        }
        this._ct = { t: new Date().getTime(), a: out };
        return out;
    },

    // justintv mac verisi: gr0k.app/script2.js; olmazsa ana sayfadaki script'ler taranir
    jtScript: function () {
        var js = getText("https://gr0k.app/script2.js", { "User-Agent": BE_UA });
        if (js && js.indexOf("karsilasmalar") !== -1) return js;
        var h = getText(this.jtBase + "/", { "User-Agent": BE_UA });
        var srcs = h ? h.match(/<script[^>]+src="[^"]+"/g) : null;
        for (var i = 0; srcs && i < srcs.length; i++) {
            var su = re(srcs[i], 'src="([^"]+)"');
            if (!su || su.indexOf("cdn-cgi") !== -1) continue;
            if (su.indexOf("http") !== 0) su = this.jtBase + (su.charAt(0) === "/" ? su : "/" + su);
            js = getText(su, { "User-Agent": BE_UA });
            if (js && js.indexOf("karsilasmalar") !== -1) return js;
        }
        return null;
    },

    // maclar kismindan YALNIZCA Barcelona - Real Madrid cekilir
    jtCards: function () {
        var c = this._jt;
        if (c && (new Date().getTime() - c.t) < 180000) return c.a;
        var out = [];
        var arr = jtArr(this.jtScript() || "", "karsilasmalar");
        for (var i = 0; arr && i < arr.length; i++) {
            var m = arr[i];
            if (!m || !m.title || !m.url) continue;
            var t = String(m.title).toLowerCase();
            if (t.indexOf("barcelona") === -1 || t.indexOf("real madrid") === -1) continue;
            if (t.indexOf("(") !== -1) continue; // "(Azerice)" varyantini atla
            var id = re(m.url, "[?&]id=([^&]+)");
            if (!id) continue;
            var parts = String(m.title).split(/\s+-\s+/);
            var home = parts[0] || "", away = parts[1] || "";
            out.push({
                pk: pairKey(home, away),
                home: home, away: away, league: m.league || "İspanya La Liga",
                name: m.title + " (" + (m.live ? "CANLI" : (m.time || "")) + ")",
                url: this.jtBase + m.url,
                plot: [m.league, m.tarih].filter(Boolean).join(" | "),
                jt: id
            });
            break; // tek mac
        }
        this._jt = { t: new Date().getTime(), a: out };
        return out;
    },

    // uc siteyi birlestir: ayni mac TEK kartta birlesir (kaynaklar load'ta toplanir)
    // beyazelma karti tercih edilir (logo+lig dolu), flag'ler birlestirilir
    merged: function () {
        var all = [], seen = {};
        var add = function (arr, ord) {
            for (var i = 0; i < arr.length; i++) {
                var it = arr[i];
                var key = it.pk;
                if (!key || key === "|") key = it.url;
                var prev = seen[key];
                if (prev) {
                    prev.be = prev.be || it.be;
                    prev.sl = prev.sl || it.sl;
                    prev.ct = prev.ct || it.ct;
                    prev.jt = prev.jt || it.jt;
                    prev.ctUrl = prev.ctUrl || (it.ct ? it.url : null);
                    if (!prev._h) { prev._h = it.home; prev._a = it.away; }
                    continue;
                }
                var card = {
                    name: it.name, url: it.url,
                    posterUrl: it.posterUrl, posterAwayUrl: it.posterAwayUrl,
                    plot: it.plot, type: "Sport",
                    league: it.league,
                    _h: it.home, _a: it.away,
                    _pk: it.pk, _ord: ord,
                    be: it.be, sl: it.sl, ct: it.ct, jt: it.jt,
                    ctUrl: it.ct ? it.url : null
                };
                seen[key] = card;
                all.push(card);
            }
        };
        add(this.beCards(), 0);
        add(this.slotinCards(), 1);
        add(this.ctCards(), 2);
        add(this.jtCards(), 3);
        // mackolik takim logolari (canlitribun ile ayni kaynak): "s:<ev>-<dep>" eslesmesi
        var logos = this.logoMap();
        for (var li = 0; li < all.length; li++) {
            var p = logos["s:" + teamKey(all[li]._h) + "-" + teamKey(all[li]._a)];
            if (p && (p.home || p.away)) {
                if (p.home) all[li].posterUrl = p.home;
                if (p.away) all[li].posterAwayUrl = p.away;
            }
        }
        // El Clasico en onde
        all.sort(function (a, b) {
            return (BE_EL[a._pk] ? 0 : 1) - (BE_EL[b._pk] ? 0 : 1);
        });
        return all;
    },

    getMainPage: function (page, req) {
        if (page > 1) return { items: [], hasNext: false };
        var cfg = null;
        for (var i = 0; i < this.mainPage.length; i++) {
            if (this.mainPage[i].name === req.name) cfg = this.mainPage[i];
        }
        var all = this.merged();
        var list = [];
        for (var i = 0; i < all.length; i++) {
            var it = all[i];
            if (cfg && cfg.lg && this.lgKey(it.league) !== cfg.lg) continue;
            list.push({
                name: it.name, url: it.url,
                posterUrl: it.posterUrl, posterAwayUrl: it.posterAwayUrl,
                plot: it.plot, type: "Sport"
            });
        }
        return { items: [{ name: req.name, list: list, type: "Sport" }], hasNext: false };
    },

    search: function (query) {
        var q = String(query || "").toLowerCase();
        if (!q) return [];
        var all = this.merged();
        var list = [];
        for (var i = 0; i < all.length; i++) {
            var it = all[i];
            if (it.name.toLowerCase().indexOf(q) === -1) continue;
            list.push({
                name: it.name, url: it.url,
                posterUrl: it.posterUrl, posterAwayUrl: it.posterAwayUrl,
                plot: it.plot, type: "Sport"
            });
        }
        return list;
    },

    // ---------------- detay / kaynak toplama ----------------

    // beyazelma zinciri: mac/kanal sayfasi -> embed -> api/play -> m3u8
    beLinks: function (pageUrl, links) {
        var h = getText(pageUrl, { "User-Agent": BE_UA });
        if (!h) return;
        var embedUrl = re(h, '(/api/embed\\?u=[^"\'\\ ]+)');
        var base = this.beBase();
        if (!embedUrl) {
            var kanal = re(h, 'href="(/kanal/[a-z0-9-]+)"') || re(h, '"(/kanal/[a-z0-9-]+)"');
            if (kanal) {
                var kh = getText(base + kanal, { "User-Agent": BE_UA, "Referer": pageUrl });
                if (kh) embedUrl = re(kh, '(/api/embed\\?u=[^"\'\\ ]+)');
            }
        }
        var slug = null, embHost = this.embHost();
        if (embedUrl) {
            var eu = embedUrl.indexOf("http") === 0 ? embedUrl : base + embedUrl;
            var eh = getText(eu, { "User-Agent": BE_UA, "Referer": pageUrl });
            slug = eh && re(eh, '"slug"\\s*:\\s*"([^"]+)"');
            // embed sayfasi kendi origin'ini tasiyor (EMBED_ORIGIN) — domain degisiminde de gecerli
            var eo = eh && re(eh, 'EMBED_ORIGIN\\s*=\\s*"([^"]+)"');
            if (eo) embHost = eo;
        }
        if (!slug) slug = re(h, '"slug"\\s*:\\s*"(tr-[a-z0-9-]+)"');
        if (!slug) { log("beyazelma: slug yok:", pageUrl); return; }
        var j = null;
        try {
            j = JSON.parse(getText(embHost + "/api/play/" + encodeURIComponent(slug),
                { "User-Agent": BE_UA, "Referer": pageUrl }) || "null");
        } catch (e) { }
        var urls = [];
        if (j) {
            if (j.primary) urls.push(j.primary);
            var fb = j.fallbacks || [];
            for (var i = 0; i < fb.length; i++) urls.push(fb[i]);
        }
        for (var k = 0; k < urls.length; k++) {
            if (!urls[k]) continue;
            links.push({
                url: urls[k],
                name: "BeyazElma " + slug + (k ? " " + (k + 1) : ""),
                source: this.name,
                referer: embHost + "/",
                headers: { "Referer": embHost + "/", "User-Agent": BE_UA },
                isM3u8: true,
                type: "hls"
            });
        }
    },

    // canlitribun mac sayfasi -> .yayin_kaynak cozumleme (vip/viptv/m3u8/frame)
    ctLinks: function (url, links) {
        var d;
        try { d = doc(url); } catch (e) { return; }
        var btns = sel(d, ".yayin_kaynak");
        var base = ctMainUrl() || "";
        var auth = base + "/auth.php";
        for (var i = 0; i < btns.length; i++) {
            var tip = attr(btns[i], "data-target");
            var link = attr(btns[i], "data-src");
            var ad = txt(btns[i]) || ("Kaynak " + (i + 1));
            if (!tip || !link) continue;
            if (tip === "vip" || tip === "viptv") {
                var ret = ctPost(auth, tip === "vip" ? { id: String(link) } : { channel: String(link) });
                if (ret && ret.URL) {
                    links.push({
                        url: ret.URL,
                        name: "CanliTribun " + ad + (ret.SERVER ? " S" + (ret.SERVER + 1) : ""),
                        source: this.name,
                        referer: base + "/",
                        quality: 720,
                        headers: {
                            "usertoken": ret.TOKEN || "",
                            "pl": "CanliTribun",
                            "Referer": base + "/",
                            "Origin": base,
                            "User-Agent": CT_UA
                        },
                        isM3u8: true, type: "hls"
                    });
                }
            } else if (tip === "m3u8") {
                links.push({
                    url: link, name: "CanliTribun " + ad, source: this.name,
                    referer: base + "/", quality: 720,
                    headers: { "Referer": base + "/", "User-Agent": CT_UA },
                    isM3u8: true, type: "hls"
                });
            } else if (tip === "frame") {
                var merged = false;
                try {
                    var r = extractor(link);
                    if (r && r.links) for (var f = 0; f < r.links.length; f++) links.push(r.links[f]);
                    merged = !!(r && r.links && r.links.length);
                } catch (e) { }
                if (!merged) links.push({ url: link, name: "CanliTribun " + ad, source: this.name, referer: base + "/", type: "embed" });
            }
        }
    },

    // justintv event host'u: "androstreamlivech*" id'ler favorisentv1o6.xyz'e yonlenir
    jtHost: function (id) {
        return /^androstreamlivech/.test(id) ? "https://favorisentv1o6.xyz" : this.jtBase;
    },

    // event.html icindeki baseurls[] listesini cozer (1 saat cache)
    jtStreamBases: function (id) {
        var c = this._jtB;
        if (c && (new Date().getTime() - c.t) < 3600000) return c.a;
        var out = [];
        var h = getText(this.jtHost(id) + "/event.html?id=" + encodeURIComponent(id), { "User-Agent": BE_UA });
        var inner = h && re(h, "baseurls\\s*=\\s*\\[([^\\]]+)");
        if (inner) {
            var m2 = inner.match(/https?:\/\/[^"'\s]+/g);
            if (m2) for (var i = 0; i < m2.length; i++) out.push(m2[i]);
        }
        if (!out.length) {
            out = [
                "https://andro.evrenesoglu219.click/checklist/",
                "https://andro.evrenesoglu211.click/checklist/",
                "https://andro.evrenesoglu215.click/checklist/",
                "https://andro.evrenesoglu217.click/checklist/"
            ];
        }
        this._jtB = { t: new Date().getTime(), a: out };
        return out;
    },

    // id -> base + id + ".m3u8" (bs1 icin batutest degil gercek yayin)
    jtLinks: function (id, links) {
        var bases = this.jtStreamBases(id);
        var ref = this.jtHost(id) + "/event.html?id=" + id;
        for (var i = 0; i < bases.length; i++) {
            links.push({
                url: bases[i] + id + ".m3u8",
                name: "JustinTV" + (i ? " " + (i + 1) : ""),
                source: this.name,
                referer: ref,
                quality: 720,
                headers: { "Referer": ref, "User-Agent": BE_UA },
                isM3u8: true, type: "hls"
            });
        }
    },

    // macin tum sitelerdeki kaynaklarini topla -> JSON data
    load: function (url) {
        url = this.fixUrl(url);
        var all = this.merged();
        var it = null;
        for (var i = 0; i < all.length; i++) {
            if (all[i].url === url) { it = all[i]; break; }
        }
        var home = it ? it._h : "", away = it ? it._a : "";
        var name = it ? it.name.replace(/\s*\([^)]*\)\s*$/, "") : cleanTitleBe(url);
        if (!home) {
            var parts = name.split(/\s+-\s+/);
            home = parts[0] || ""; away = parts[1] || "";
        }
        var sources = [];
        var isBe = /\/\/(www\.)?(beyazelma\d+|elmacibaba)\./.test(url);
        if (isBe) sources.push({ ad: "BeyazElma", tip: "be", link: url });
        // beyazelma karti yoksa da ayni maci "today" icinde ara -> varsa kanal sayfasi
        if (!it || !it.be) {
            var be = this.beCards();
            var pk = pairKey(home, away);
            for (var b = 0; b < be.length; b++) {
                if (be[b].pk === pk) { sources.push({ ad: "BeyazElma", tip: "be", link: be[b].url }); break; }
            }
        } else if (it && it.be && !isBe) {
            sources.push({ ad: "BeyazElma", tip: "be", link: it.url });
        }
        // slotin
        var slId = it && it.sl;
        if (!slId) {
            var sls = this.slotinCards();
            var pk2 = pairKey(home, away);
            for (var s2 = 0; s2 < sls.length; s2++) {
                if (sls[s2].pk === pk2) { slId = sls[s2].sl; break; }
            }
        }
        if (slId) sources.push({ ad: "Slotin HD", tip: "zirve", link: slId });
        // canlitribun
        var ctUrl = it && it.ctUrl;
        if (!ctUrl) {
            var cts = this.ctCards();
            var pk3 = pairKey(home, away);
            for (var c2 = 0; c2 < cts.length; c2++) {
                if (cts[c2].pk === pk3) { ctUrl = cts[c2].url; break; }
            }
        }
        if (ctUrl) sources.push({ ad: "CanliTribun", tip: "ct", link: ctUrl });
        // justintv (Barcelona - Real Madrid)
        var jtId = it && it.jt;
        if (!jtId) {
            var jts = this.jtCards();
            var pk4 = pairKey(home, away);
            for (var j2 = 0; j2 < jts.length; j2++) {
                if (jts[j2].pk === pk4) { jtId = jts[j2].jt; break; }
            }
        }
        if (jtId) sources.push({ ad: "JustinTV", tip: "jt", link: jtId });
        // slotin/ct url'sinden gelindi: mac sayfasi kendisi kaynak olarak yoksa kendi zinciri
        if (!sources.length) {
            if (/[?&]id=/.test(url)) sources.push({ ad: "Slotin HD", tip: "zirve", link: re(url, "[?&]id=([^&]+)") || url });
            else if (ctMainUrl() && url.indexOf(ctMainUrl()) === 0) sources.push({ ad: "CanliTribun", tip: "ct", link: url });
            else sources.push({ ad: "BeyazElma", tip: "be", link: url });
        }
        var data = JSON.stringify(sources);
        return {
            name: name || "Canlı Maç",
            url: url,
            type: "Sport",
            posterUrl: it ? it.posterUrl : null,
            backgroundPosterUrl: it ? it.posterAwayUrl : null,
            dataUrl: data,
            episodes: [{ data: data, name: "Canlı Yayın", season: 1, episode: 1 }]
        };
    },

    loadLinks: function (data) {
        var links = [], subs = [];
        var sources = [];
        try { sources = JSON.parse(data); } catch (e) { sources = []; }
        if (!sources.length) sources = [{ ad: "BeyazElma", tip: "be", link: String(data) }];
        for (var i = 0; i < sources.length; i++) {
            var s = sources[i];
            if (s.tip === "be") {
                this.beLinks(this.fixUrl(s.link), links);
            } else if (s.tip === "ct") {
                this.ctLinks(s.link, links);
            } else if (s.tip === "jt") {
                this.jtLinks(String(s.link), links);
            } else if (s.tip === "zirve") {
                var sid = String(s.link);
                var streamUrl = null;
                if (sid.indexOf("http") === 0) {
                    streamUrl = sid;
                } else {
                    try {
                        var dr = JSON.parse(getText(this.slotin.dataUrl + "/domain.php") || "{}");
                        if (dr && dr.baseurl) streamUrl = dr.baseurl + sid + "/mono.m3u8";
                    } catch (e) { log("domain.php:", e); }
                }
                if (streamUrl) {
                    links.push({
                        url: streamUrl,
                        name: s.ad || "Slotin HD",
                        source: this.name,
                        referer: this.slotin.mainUrl + "/",
                        quality: 1080,
                        headers: {
                            "Referer": this.slotin.mainUrl + "/",
                            "Origin": this.slotin.mainUrl,
                            "User-Agent": BE_UA
                        },
                        isM3u8: true, type: "hls"
                    });
                }
            } else if (s.tip === "m3u8") {
                links.push({
                    url: s.link, name: s.ad || "Kaynak", source: this.name,
                    referer: this.mainUrl + "/", quality: 720,
                    headers: { "Referer": this.mainUrl + "/", "User-Agent": BE_UA },
                    isM3u8: true, type: "hls"
                });
            }
        }
        var seen = {}, out = [];
        for (var k = 0; k < links.length; k++) {
            if (seen[links[k].url]) continue;
            seen[links[k].url] = 1;
            out.push(links[k]);
        }
        log("beyazelma loadLinks | kaynak:", sources.length, "| link:", out.length);
        return { links: out, subtitles: subs };
    }
};

function cleanTitleBe(url) {
    var s = String(url || "");
    var m = /\/mac\/([^/?#]+)/.exec(s) || /\/([^/?#]+)$/.exec(s);
    s = m ? m[1] : s;
    return s.replace(/-vs-/g, " - ").replace(/-/g, " ").trim();
}
