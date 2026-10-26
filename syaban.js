// yabancidizi.news kaynak eklentisi — CloudMediaPlayer JS köprüsü, tamamen JS (python gerekmez).
// Yardımcılar: doc(url,headers?), text(url,headers?), post(url,form,headers?)->string,
//   http(url,{method,headers,data,body})->{code,url,text}, sel, txt, html, attr(href/src=absUrl),
//   re, abs, extractor, log
//
// Akış (sitenin kendisiyle aynı):
//   bölüm sayfası -> kaynaklar (div.item[data-hash][data-link]) + dil sekmeleri (a[data-lango])
//   POST /ajax/service {type:"videoGet"} -> api_iframe (wrapper URL)
//   GET wrapper (udys/ydt cookie)        -> dış embed URL (iframe)
//   embed -> m3u8: molystream=dbx sheila kalıbı, vidmoly=file:, ok.ru=data-options, genel=m3u8 regex

function postJson(url, params, headers) {
    try { return JSON.parse(post(url, params, headers)); } catch (e) { return null; }
}

function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}

function unescapeHtml(s) {
    return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

// Ana sayfa bolumu kullanilmiyor — kesfet kategorileri kaldirildi.

var provider = {
    name: "YabanciDizi (JS)",
    mainUrl: "https://yabancidizi.news",
    lang: "tr",
    supportedTypes: ["TvSeries", "Movie"],
    // Ana sayfa bolumu yok — eklenti yalniz arama ile kullanilir.
    mainPage: [],

    fixUrl: function (u) {
        if (!u) return u;
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("/") === 0) return this.mainUrl + u;
        return this.mainUrl + "/" + u;
    },

    pathOf: function (u) {
        if (u.indexOf("http") === 0) return re(u, "https?://[^/]+(/.*)$") || "/";
        return u.indexOf("/") === 0 ? u : "/" + u;
    },

    jsCookies: function () {
        var ts = String(Date.now());
        return "udys=" + ts + "; ydt=" + ts;
    },

    card: function (el) {
        var a = sel(el, "a[href]")[0];
        if (!a) return null;
        var href = attr(a, "href");   // köprü mutlak URL döndürür
        var isEp = /\/bolum-\d+/.test(href);
        var isFilm = href.indexOf("/film/") >= 0;
        var name;
        if (isEp) {
            var h = txt(sel(el, "h2.truncate")[0]);
            var no = txt(sel(el, "span.episode-no")[0]).replace(/·/g, " ");
            name = (h + (no ? " - " + no : "")).trim();
        } else {
            var t = attr(a, "title") || txt(a) || txt(sel(el, "h2.truncate")[0]);
            name = t.replace(/\s+izle\s*$/i, "").replace(/\s+Film\s*$/i, "").trim();
        }
        var img = sel(el, "img")[0];
        var src = img ? (attr(img, "data-src") || attr(img, "src")) : "";
        if (src && src.indexOf("data:") === 0) src = "";
        return {
            name: name,
            url: href,
            posterUrl: this.fixUrl(src),
            year: parseInt(txt(sel(el, ".year")[0]), 10) || null,
            rating: parseFloat(txt(sel(el, ".rating")[0])) || null,
            type: isFilm ? "Movie" : "TvSeries",
            _kind: isEp ? "ep" : "series"
        };
    },

    getMainPage: function (page, req) {
        var cfg = null;
        var mp = this.mainPage;
        for (var i = 0; i < mp.length; i++) if (mp[i].name === req.name) cfg = mp[i];
        if (!cfg) return { items: [], hasNext: false };
        var url = cfg.url;
        if (cfg.paging && page > 1) url = url.replace(/\/+$/, "") + "/" + page;
        var d;
        try { d = doc(abs(url)); } catch (e) { return { items: [], hasNext: false }; }
        var out = sel(d, cfg.list);
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.name && c.url) {
                var kind = c._kind;
                delete c._kind;
                if (!cfg.kind || kind === cfg.kind) list.push(c);
            }
        }
        // kesfet sayfalari <b64>/<sayfa> deseninde sayfalanir; sonraki sayfa
        // linki varsa devam vardir
        var hasNext = false;
        if (cfg.paging) {
            var suf = "/" + (page + 1);
            var links = sel(d, "a[href]");
            for (var p = 0; p < links.length; p++) {
                var hr = String(attr(links[p], "href") || "").replace(/\/+$/, "");
                if (hr.length > suf.length && hr.lastIndexOf(suf) === hr.length - suf.length) {
                    hasNext = true;
                    break;
                }
            }
        }
        return { items: [{ name: req.name, list: list }], hasNext: hasNext };
    },

    search: function (query) {
        var list = [];
        var j = postJson(this.mainUrl + "/search?qr=" + encodeURIComponent(query), {}, {
            "Cookie": this.jsCookies(),
            "Referer": this.mainUrl + "/",
            "X-Requested-With": "XMLHttpRequest"
        });
        var rows = j && j.data && j.data.result;
        if (!rows) return list;
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r.s_link) continue;
            var film = String(r.s_type) === "1";
            list.push({
                name: r.s_name,
                url: this.mainUrl + (film ? "/film/" : "/dizi/") + r.s_link,
                posterUrl: r.s_image ? this.mainUrl + "/uploads/series/" + r.s_image : null,
                year: parseInt(r.s_year) || null,
                type: film ? "Movie" : "TvSeries"
            });
        }
        return list;
    },

    load: function (url) {
        var path = this.pathOf(url);
        var d = doc(url);

        // film sayfası: direkt izlenebilir
        if (path.indexOf("/film/") === 0) {
            return {
                name: txt(sel(d, "h1.page-title")[0]) || attr(sel(d, 'meta[property="og:title"]')[0], "content"),
                url: url,
                type: "Movie",
                posterUrl: this.fixUrl(attr(sel(d, 'meta[property="og:image"]')[0], "content")),
                plot: attr(sel(d, 'meta[name="description"]')[0], "content"),
                dataUrl: path,
                episodes: [{ data: path, name: "Film", season: 1, episode: 1 }]
            };
        }

        // bölüm sayfası: breadcrumb'tan dizi sayfasına yönlendir
        if (/\/bolum-\d+/.test(path)) {
            var crumbs = sel(d, 'a[property="v:title"]');
            var seriesHref = null;
            for (var i = 0; i < crumbs.length; i++) {
                var h = attr(crumbs[i], "href");
                if (h && h.indexOf("/bolum-") < 0) { seriesHref = h; break; }
            }
            if (seriesHref) return this.load(seriesHref);
            return null;
        }

        // dizi sayfası: sezon tablarından bölüm listesi
        var eps = [];
        var tabs = sel(d, "div.ui.tab[data-season]");
        for (var t = 0; t < tabs.length; t++) {
            var season = parseInt(attr(tabs[t], "data-season")) || 1;
            var anchors = sel(tabs[t], 'a[href*="/bolum-"]');
            var best = {};
            var order = [];
            for (var a = 0; a < anchors.length; a++) {
                var h = attr(anchors[a], "href");   // mutlak URL
                var epno = parseInt(re(h, "bolum-(\\d+)")) || 0;
                if (!epno) continue;
                var title = txt(anchors[a]).trim();
                if (!best[epno]) order.push(epno);
                if (!best[epno] || title.length > best[epno].title.length) {
                    best[epno] = { ep: epno, title: title, href: h };
                }
            }
            order.sort(function (x, y) { return x - y; });
            for (var k = 0; k < order.length; k++) {
                var e = best[order[k]];
                eps.push({
                    data: this.pathOf(e.href),   // "/dizi/x/sezon-N/bolum-M"
                    name: e.title || ("Bölüm " + e.ep),
                    season: season,
                    episode: e.ep
                });
            }
        }
        return {
            name: txt(sel(d, "h1.page-title")[0]) || attr(sel(d, 'meta[property="og:title"]')[0], "content"),
            url: url,
            type: "TvSeries",
            posterUrl: this.fixUrl(attr(sel(d, 'meta[property="og:image"]')[0], "content")),
            plot: attr(sel(d, 'meta[name="description"]')[0], "content"),
            dataUrl: path,
            episodes: eps
        };
    },

    // div.item[data-hash][data-link] kaynaklarını topla
    parseSources: function (d, suffix) {
        var out = [];
        var items = sel(d, "div.item[data-hash][data-link]");
        for (var i = 0; i < items.length; i++) {
            var name = txt(items[i]).trim();
            var link = attr(items[i], "data-link");
            var hash = attr(items[i], "data-hash");
            if (name && link) out.push({ name: name + (suffix || ""), hash: hash, link: link });
        }
        return out;
    },

    // langTab HTML bloğundaki kaynaklar (düz metin regex)
    parseLangBlock: function (block, langName) {
        var out = [];
        var rx = /<div[^>]*data-hash="([^"]+)"[^>]*data-link="([^"]+)"[^>]*>([^<]*)<\/div>/g;
        var m;
        while ((m = rx.exec(block))) {
            var name = m[3].trim();
            if (name) out.push({ name: name + " (" + langName + ")", hash: m[1], link: m[2] });
        }
        return out;
    },

    extractEmbed: function (page) {
        var m = page.match(/(?:<iframe[^>]+src=["']|window\.location(?:\.href)?\s*=\s*["']|location\.replace\(["']|url=["'])(https?:\/\/[^"'<>\s]+)/i);
        if (m) return unescapeHtml(m[1]);
        var m2 = page.match(/https?:\/\/(?:ydx\.molystream|vidmoly|ok\.ru|sibnet|okcdn|voe|filemoon|dood|mixdrop|uqload|streamtape)[^"'<>\s]*/);
        return m2 ? unescapeHtml(m2[0]) : null;
    },

    okruStream: function (embed) {
        var ref = "https://" + re(embed, "https?://([^/]+)") + "/";
        var h = getText(embed, { "Referer": this.mainUrl + "/" });
        if (!h) return null;
        var m = h.match(/data-options='([^']+)'/) || h.match(/data-options="([^"]+)"/);
        if (m) {
            try {
                var opts = JSON.parse(unescapeHtml(m[1]));
                var meta = (opts.flashvars && opts.flashvars.metadata) || opts.metadata;
                if (typeof meta === "string") meta = JSON.parse(meta);
                if (meta) {
                    var v = meta.hlsManifestUrl || meta.ondemandHls || meta.hls;
                    if (typeof v === "string" && v.indexOf("http") === 0) return { url: v, ref: ref };
                    var vids = meta.videos || [];
                    var order = { full: 0, quad: 1, hd: 2, sd: 3, high: 4, low: 5, lowest: 6, mobile: 7, tiny: 8 };
                    var best = null, bi = 99;
                    for (var i = 0; i < vids.length; i++) {
                        if (!vids[i].url) continue;
                        var o = order[(vids[i].name || "").toLowerCase()];
                        if (o === undefined) o = 9;
                        if (o < bi) { bi = o; best = vids[i]; }
                    }
                    if (best) return { url: best.url, ref: ref };
                }
            } catch (e) { }
        }
        var u = unescapeHtml(h);
        var m2 = u.match(/"(?:ondemandHls|hlsManifestUrl|hls)"\s*:\s*"((?:\\.|[^"\\])+)"|"(?:url|src)"\s*:\s*"((?:\\.|[^"\\])+?\.(?:m3u8|mp4)(?:\?[^"\\]*)?)"/);
        if (m2) {
            var url = (m2[1] || m2[2] || "").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
            if (url.indexOf("http") === 0) return { url: url, ref: ref };
        }
        return null;
    },

    embedToStream: function (embed) {
        var host = re(embed, "https?://([^/]+)");
        var ref = "https://" + host + "/";
        var mm = embed.match(/https?:\/\/[^/]+\/embed\/([A-Za-z0-9_-]+)/);

        // molystream ailesi: sheila kalıbı sitenin player'ının kullandığı gerçek m3u8 adresi
        if (/(molystream|sheila\.stream|moly\w*)\.(org|stream|to|net|online)/.test(embed) && mm) {
            return { url: "https://dbx.molystream.org/embed/sheila/" + mm[1], ref: ref };
        }
        // vidmoly embed: sayfada file: ile m3u8
        if (/vidmoly\.(biz|me|to|net)/.test(embed)) {
            var h = getText(embed, { "Referer": this.mainUrl + "/" });
            var f = h && (h.match(/file:\s*'([^']+\.m3u8[^']*)'/) || h.match(/"(https?:\/\/[^"]+\.m3u8[^"]*)"/));
            if (f) return { url: unescapeHtml(f[1]), ref: "https://vidmoly.biz/" };
            return null;
        }
        // ok.ru / vk / mailru / sibnet ailesi
        if (/(ok\.ru|odnoklassniki|okcdn|my\.mail\.ru|mail\.ru|vk\.com|vkvideo|video\.sibnet\.ru)/.test(embed)) {
            return this.okruStream(embed);
        }
        // genel: embed sayfasında m3u8 ara
        var g = getText(embed, { "Referer": this.mainUrl + "/" });
        if (g) {
            var m2 = unescapeHtml(g).match(/https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*/);
            if (m2) return { url: m2[0], ref: ref };
        }
        return null;
    },

    // tek kaynak: videoGet -> wrapper -> embed -> stream
    resolve: function (s, epPath, ck) {
        var epUrl = this.mainUrl + epPath;
        var j = postJson(this.mainUrl + "/ajax/service", {
            link: s.link, hash: s.hash, querytype: "alternate", type: "videoGet"
        }, {
            "Cookie": ck,
            "Referer": epUrl,
            "Origin": this.mainUrl,
            "X-Requested-With": "XMLHttpRequest"
        });
        if (!j || !j.api_iframe) return null;
        var embed = j.api_iframe;
        if (embed.indexOf("yabancidizi") >= 0) {
            var w = getText(embed, { "Cookie": ck, "Referer": epUrl });
            if (w) {
                var e2 = this.extractEmbed(w);
                if (e2) embed = e2;
            }
        }
        // hata/landing sayfalarını ele
        if (/cloudflare|5xx-error|challenge/.test(embed)) return null;
        var st = this.embedToStream(embed);
        if (st) return { kind: "stream", url: st.url, ref: st.ref, embed: embed };
        return { kind: "embed", url: embed };
    },

    loadLinks: function (data) {
        var path = this.pathOf(data);
        var links = [];
        var ck = this.jsCookies();

        var d = doc(this.mainUrl + path);
        var sources = this.parseSources(d);

        // diğer dil sekmeleri (dublaj) -> langTab POST
        var tabs = sel(d, "a[data-lango]");
        for (var t = 0; t < tabs.length; t++) {
            var cls = attr(tabs[t], "class") || "";
            if (cls.indexOf("active") >= 0) continue;  // aktif sekmenin kaynakları zaten alındı
            var eid = attr(tabs[t], "data-eid");
            var ltype = attr(tabs[t], "data-type");
            var lname = txt(tabs[t]).trim() || "Dublaj";
            if (!eid) continue;
            var j = postJson(this.mainUrl + "/ajax/service", {
                lang: ltype, episode: eid, type: "langTab"
            }, { "Cookie": ck, "Referer": this.mainUrl + path, "X-Requested-With": "XMLHttpRequest" });
            if (j && j.data) {
                var extra = this.parseLangBlock(j.data, lname);
                for (var x = 0; x < extra.length; x++) sources.push(extra[x]);
            }
        }

        // aynı linki tekrar çözme
        var seen = {};
        for (var i = 0; i < sources.length; i++) {
            var s = sources[i];
            if (seen[s.link]) continue;
            seen[s.link] = 1;
            var r;
            try { r = this.resolve(s, path, ck); } catch (e) { log("resolve hata:", e); r = null; }
            if (!r) continue;
            var linkName = "YD " + (s.name || ("Kaynak " + (i + 1)));
            if (r.kind === "stream" && r.url) {
                links.push({
                    url: r.url,
                    name: linkName,
                    source: this.name,
                    referer: r.ref || r.embed,
                    headers: { "Referer": r.ref || r.embed || this.mainUrl + "/" },
                    type: "hls"
                });
            } else if (r.kind === "embed" && r.url) {
                // uygulamanın genel extractor'ı çözer
                links.push({
                    url: r.url,
                    name: linkName,
                    source: this.name,
                    referer: this.mainUrl + "/",
                    type: "embed"
                });
            }
        }
        log("loadLinks:", path, "| kaynak:", sources.length, "| link:", links.length);
        return { links: links, subtitles: [] };
    }
};
