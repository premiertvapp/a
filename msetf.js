// setfilmizle.ltd kaynak eklentisi — film + dizi + arama.
// Yardimcilar: doc(url), text(url), post(url,form,headers)->string,
//   http(url,{method,headers,body})->{code,url,text}, sel, txt, attr, re, abs, extractor, log
//
// Akis:
//   liste: /film/ ve /dizi/ (+ /page/N/) -> a.card-link kartlari
//   detay: .fbox-* kunyesi (baslik/yil/tur/puan/ozet), dizi icin .season-panel a.fep
//   video: POST admin-ajax get_video_url (nonce = STF_AJAX.nonces.video)
//     -> stream.type "bridge": setplay.sbs kopr sayfasi SPG.cerceve(id,enc,key)
//        atob XOR ile iframe adresini cozer -> fastplay.mom embed
//     -> fastplay sayfasi window.STF_KOPRU.src = /manifests/.../master.txt (m3u8)
//     -> stream.src: dogrudan kaynak + subtitles | data.url: iframe embed
//     -> data.yt: fragman, atlanir
//
// Dikkat: fastplay /manifests/ uclari masaustu tarayici UA'sina 404 doner
// (legal istekler sayfada enjekte edilen X-Sp basligiyla gider); oynaticiya
// tarayici disi UA verilir. srv.*.cfd segmentleri ise Referer ister.

var SF_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// kazima istekleri icin tarayici UA'si
var SF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// oynatici akisi icin TARAYICI DISI UA — fastplay manifestleri Chrome/Windows UA'sina 404 verir
var SF_PLAYER_UA = "Mozilla/5.0";

// base64 -> byte-string (charCode = byte)
function sfB64dec(input) {
    var str = String(input).replace(/[^A-Za-z0-9+\/]/g, "");
    var out = "", bc = 0, bs = 0;
    for (var i = 0; i < str.length; i++) {
        var v = SF_B64.indexOf(str.charAt(i));
        if (v < 0) continue;
        bc = (bc << 6) | v; bs += 6;
        if (bs >= 8) { bs -= 8; out += String.fromCharCode((bc >> bs) & 0xFF); }
    }
    return out;
}

// SPG.cerceve'nin XOR anahtarlamasi: atob(enc) ^ atob(key) -> "url|..." metni
function sfXorDec(enc, key) {
    var r = sfB64dec(enc), o = sfB64dec(key);
    if (!r || !o) return "";
    var s = "";
    for (var i = 0; i < r.length; i++) {
        s += String.fromCharCode(r.charCodeAt(i) ^ o.charCodeAt(i % o.length));
    }
    return s;
}

function sfGet(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}

// "https://host/..." -> "https://host"
function sfOrigin(u) {
    var m = /^(https?:\/\/[^\/]+)/.exec(String(u || ""));
    return m ? m[1] : "";
}

var provider = {
    name: "SetFilmizle (JS)",
    mainUrl: "https://www.setfilmizle.ltd",
    mirrors: ["https://www.setfilmizle.ltd"],
    lang: "tr",
    supportedTypes: ["Movie", "TvSeries"],
    // Ana sayfa bolumu yok — eklenti yalniz arama ile kullanilir.
    mainPage: [],

    fixUrl: function (u) {
        if (!u) return u;
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        if (u.indexOf("/") === 0) return this.mainUrl + u;
        return this.mainUrl + "/" + u;
    },

    // a.card-link karti -> film/dizi karti; tip href'ten anlasilir
    card: function (el) {
        var url = attr(el, "href");
        if (!url) return null;
        var isMovie = url.indexOf("/film/") !== -1;
        if (!isMovie && url.indexOf("/dizi/") === -1) return null;

        var name = txt(sel(el, ".card-ad")[0]).trim()
            || String(attr(sel(el, "img")[0], "alt") || "").trim();
        if (!name) return null;

        var meta = txt(sel(el, ".meta")[0]) || "";
        var year = null;
        var ym = /(\d{4})/.exec(meta);
        if (ym) year = parseInt(ym[1], 10);

        return {
            name: name,
            url: url,
            posterUrl: this.fixUrl(attr(sel(el, ".poster-art img")[0], "src")
                || attr(sel(el, "img")[0], "src") || ""),
            year: year,
            rating: parseFloat(txt(sel(el, ".badge-imdb")[0])) || null,
            quality: txt(sel(el, ".badge-lang")[0]).trim() || null,
            type: isMovie ? "Movie" : "TvSeries"
        };
    },

    getMainPage: function (page, req) {
        var cfg = null;
        var mp = this.mainPage;
        for (var i = 0; i < mp.length; i++) if (mp[i].name === req.name) cfg = mp[i];
        if (!cfg) return { items: [], hasNext: false };
        var url = page > 1 ? cfg.url + "page/" + page + "/" : cfg.url;
        var d;
        try { d = doc(abs(url)); } catch (e) { return { items: [], hasNext: false }; }
        var out = sel(d, "a.card-link");
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.type === cfg.type) list.push(c);
        }
        var hasNext = sel(d, "a.next.page-numbers").length > 0;
        return { items: [{ name: req.name, list: list, type: cfg.type }], hasNext: hasNext };
    },

    // /?s= — film ve dizi karisik gelir
    search: function (query) {
        var d;
        try { d = doc(abs("/?s=" + encodeURIComponent(query))); } catch (e) { return []; }
        var out = sel(d, "a.card-link");
        var list = [];
        for (var j = 0; j < out.length; j++) {
            var c = this.card(out[j]);
            if (c && c.name && c.url) list.push(c);
        }
        return list;
    },

    // .fbox-info icindeki "Etiket: deger" satirini okur (Yil/Tur/Ulke/...)
    infoField: function (d, label) {
        var spans = sel(d, ".fbox-info span");
        for (var i = 0; i < spans.length; i++) {
            var t = txt(spans[i]);
            if (t.indexOf(label) === 0) {
                var links = sel(spans[i], "a"), parts = [];
                for (var k = 0; k < links.length; k++) {
                    var lt = txt(links[k]).trim();
                    if (lt) parts.push(lt);
                }
                return parts.length ? parts.join(", ") : t.replace(/^[^:]+:\s*/, "").trim();
            }
        }
        return "";
    },

    load: function (url) {
        var d = doc(this.fixUrl(url));
        var isMovie = url.indexOf("/film/") !== -1;
        var isBolum = url.indexOf("/bolum/") !== -1;

        var name = txt(sel(d, ".fbox-title-tx")[0]).trim()
            || txt(sel(d, ".ep-head-tx")[0]).trim();
        if (!name) name = (re(String(url), "/(?:film|dizi)/([^/]+)/") || "Film").replace(/-/g, " ");
        name = name.replace(/\s*-\d{4}-izle$/i, "").replace(/\s+/g, " ").trim();

        var year = parseInt(re(txt(sel(d, ".fbox-date")[0]) || "", "(\\d{4})"), 10)
            || parseInt(this.infoField(d, "Yıl:"), 10) || null;
        var genre = this.infoField(d, "Tür:");
        var country = this.infoField(d, "Ülke:");
        var duration = this.infoField(d, "Süre:");
        var plot = txt(sel(d, ".fbox-desc p")[0]).trim()
            || attr(sel(d, 'meta[name="description"]')[0], "content") || "";
        var meta = [genre, duration, country].filter(function (x) { return x; }).join(" · ");

        var poster = attr(sel(d, "img.fbox-cover-img")[0], "src")
            || attr(sel(d, ".player-poster img")[0], "src") || "";

        var episodes = [];
        if (isMovie) {
            episodes.push({ data: this.fixUrl(url), name: "Film", season: 1, episode: 1 });
        } else if (isBolum) {
            var bt = txt(sel(d, ".ep-head-title b")[0]).trim() || "Bölüm";
            episodes.push({
                data: this.fixUrl(url),
                name: bt,
                season: parseInt(re(String(url), "(\\d+)-sezon"), 10) || 1,
                episode: parseInt(re(String(url), "sezon-(\\d+)-bolum"), 10) || 1
            });
        } else {
            // dizi sayfasi: her .season-panel kendi sezon numarasini tasir
            var panels = sel(d, ".season-panel[data-season]");
            for (var p = 0; p < panels.length; p++) {
                var sn = parseInt(attr(panels[p], "data-season"), 10) || (p + 1);
                var feps = sel(panels[p], "a.fep");
                for (var e = 0; e < feps.length; e++) {
                    var href = attr(feps[e], "href");
                    if (!href) continue;
                    episodes.push({
                        data: href,
                        name: txt(sel(feps[e], ".fep-title")[0]).trim() || "Bölüm",
                        season: parseInt(re(href, "(\\d+)-sezon"), 10) || sn,
                        episode: parseInt(re(href, "sezon-(\\d+)-bolum"), 10) || (e + 1)
                    });
                }
            }
            episodes.sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
            if (!episodes.length) {
                episodes.push({ data: this.fixUrl(url), name: "İzle", season: 1, episode: 1 });
            }
        }

        return {
            name: name,
            url: url,
            type: isMovie ? "Movie" : "TvSeries",
            posterUrl: this.fixUrl(poster),
            plot: meta ? meta + "\n\n" + plot : plot,
            year: year,
            rating: parseFloat(txt(sel(d, ".imdb-score")[0])) || null,
            dataUrl: this.fixUrl(url),
            episodes: episodes
        };
    },

    // admin-ajax get_video_url cagrisi -> res.data nesnesi
    videoAjax: function (pageUrl, postId, nonce, name, part) {
        try {
            var r = post("https://www.setfilmizle.ltd/wp-admin/admin-ajax.php", {
                action: "get_video_url",
                nonce: nonce,
                post_id: postId,
                player_name: name,
                part_key: part || ""
            }, {
                "X-Requested-With": "XMLHttpRequest",
                "Referer": pageUrl,
                "User-Agent": SF_UA
            });
            var j = JSON.parse(r);
            return (j && j.success && j.data) ? j.data : null;
        } catch (e) { return null; }
    },

    // setplay kopr sayfasi -> ic iframe (fastplay) adresini XOR ile cozer
    bridgeUrl: function (bridgePage) {
        var m = /SPG\.cerceve\(\s*"[^"]*"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(bridgePage);
        if (!m) return null;
        var dec = sfXorDec(m[1], m[2]).split("|")[0];
        return /^https?:\/\//.test(dec) ? dec : null;
    },

    // fastplay embed sayfasi -> manifest (m3u8) + altyazilar
    fastplayResolve: function (embedUrl, pageUrl) {
        var h = sfGet(embedUrl, { "Referer": pageUrl, "User-Agent": SF_UA });
        if (!h) return null;
        var src = re(h, "STF_KOPRU\\s*=\\s*\\{[\\s\\S]*?src:\\s*\"([^\"]+)\"")
            || re(h, "src:\\s*\"([^\"]+)\"");
        if (!src) return null;
        src = src.replace(/\\\//g, "/");
        if (src.indexOf("http") !== 0) src = sfOrigin(embedUrl) + (src.indexOf("/") === 0 ? "" : "/") + src;

        var subs = [];
        var sm = /subtitles:\s*(\[[\s\S]*?\])/.exec(h);
        if (sm) {
            var arr = null;
            try { arr = JSON.parse(sm[1]); } catch (e) { arr = null; }
            if (arr) {
                for (var i = 0; i < arr.length; i++) {
                    var t = arr[i] || {};
                    if (t.kind && t.kind !== "captions" && t.kind !== "subtitles") continue;
                    if (t.file) subs.push({ lang: t.label || t.lang || "Altyazi", url: t.file });
                }
            } else {
                var fm, fr = /"file"\s*:\s*"([^"]+\.vtt[^"]*)"/g;
                while ((fm = fr.exec(sm[1]))) subs.push({ lang: "Altyazi", url: fm[1].replace(/\\\//g, "/") });
            }
        }
        return { stream: src, subs: subs, origin: sfOrigin(embedUrl), referer: sfOrigin(embedUrl) + "/" };
    },

    loadLinks: function (data) {
        var pageUrl = this.fixUrl(data);
        var links = [], subs = [];
        var h = sfGet(pageUrl, { "User-Agent": SF_UA });
        if (!h) return { links: links, subtitles: subs };

        var postId = re(h, "id=\"stfPlayer\"[^>]*data-post-id=\"(\\d+)\"")
            || re(h, "data-post-id=\"(\\d+)\"");
        var nonce = re(h, "video:\\s*\"([a-zA-Z0-9]+)\"");
        if (!postId || !nonce) return { links: links, subtitles: subs };

        // kaynak sekmeleri: data-player-name + data-part-key
        var tabs = [], seen = {};
        var tm, tr = /data-player-name="([^"]+)"[^>]*data-part-key="([^"]*)"/g;
        while ((tm = tr.exec(h))) {
            var key = tm[1] + "|" + tm[2];
            if (seen[key]) continue;
            seen[key] = 1;
            tabs.push({ name: tm[1], part: tm[2] });
        }
        if (!tabs.length) tabs.push({ name: "SetPlay", part: "" });

        for (var i = 0; i < tabs.length; i++) {
            var t = tabs[i];
            var tag = "SF " + t.name + (t.part ? " " + t.part : "");
            var res = null;
            try { res = this.videoAjax(pageUrl, postId, nonce, t.name, t.part); } catch (e) { res = null; }
            if (!res) continue;

            var st = res.stream || {};
            var stream = null;
            // segmentler srv.*.cfd hostlarinda ve Referer olarak oynatici
            // (fastplay/setplay) kokenini istiyor; sayfa adresiyle 403/404 doner
            var ref = pageUrl, org = sfOrigin(pageUrl);

            if (st.type === "bridge" && st.url) {
                // kopru -> ic iframe adresi -> fastplay manifest
                var bh = sfGet(st.url, { "Referer": pageUrl, "User-Agent": SF_UA });
                var embed = bh ? this.bridgeUrl(bh) : null;
                if (embed) {
                    var fp = this.fastplayResolve(embed, pageUrl);
                    if (fp) {
                        stream = fp.stream;
                        ref = fp.referer;
                        org = fp.origin;
                        for (var s = 0; s < fp.subs.length; s++) subs.push(fp.subs[s]);
                    }
                }
                if (!stream) {
                    // cozulemezse embed'i uygulamanin extractor'ina birak
                    links.push({ url: st.url, name: tag, source: this.name, referer: pageUrl, type: "embed" });
                    continue;
                }
            } else if (st.src) {
                stream = st.src.replace(/\\\//g, "/");
                var ss = st.subtitles || [];
                for (var s2 = 0; s2 < ss.length; s2++) {
                    if (ss[s2] && ss[s2].file) subs.push({ lang: ss[s2].label || ss[s2].lang || "Altyazi", url: ss[s2].file });
                }
            } else if (res.url) {
                links.push({ url: res.url, name: tag, source: this.name, referer: pageUrl, type: "embed" });
                continue;
            } else {
                continue; // yt fragmani vb.
            }

            if (stream) {
                var isHls = /\.m3u8|\/manifests\/|\/master|\/hls\//i.test(stream);
                links.push({
                    url: stream,
                    name: tag,
                    source: this.name,
                    referer: ref,
                    headers: { "Referer": ref, "Origin": org, "User-Agent": SF_PLAYER_UA },
                    isM3u8: isHls,
                    type: isHls ? "hls" : "direct"
                });
            }
        }

        log("loadLinks:", pageUrl, "| kaynak:", tabs.length, "| link:", links.length, "| sub:", subs.length);
        return { links: links, subtitles: subs };
    }
};
