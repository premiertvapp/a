// ddizimag.com kaynak eklentisi — CloudMediaPlayer JS köprüsü, tamamen JS.
// Yardimcilar: doc(url), text(url), http(url,{method,headers,data,body})->{code,url,text},
//   sel(el,css), txt(el), attr(el,"href"), re(str,regex), abs(url), extractor(url), log(...)
//
// Akis zinciri:
//   ana sayfa : section.container-site > h2.section-title + a.group.block kartlari
//               "Son Eklenen Diziler" -> /diziler?sirala=yeni (?page=N)
//   arama     : GET /ara?q=<q> -> a.group.block (/dizi/ /film/ /anime/ linkleri)
//   detay     : /dizi/<slug> ld+json TVSeries + ?sezon=N sayfalarindan
//               /sezon-N/bolum-M linkleri (film: /film/<slug>, tek oynatici)
//   stream    : bolum/film sayfasi data-pv="<slug>"
//               -> <host>/assets/js/s.php?s=<slug>
//               -> window.__PLAYER__.stream (master.m3u8) + .subs

var DM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}

function getDoc(url) {
    try { return doc(url, { "User-Agent": DM_UA }); } catch (e) { return null; }
}

// ---------------- yerel playlist sunucusu ----------------
// Uygulama HLS yolunda (HlsMediaSource.Factory) yan altyazilari (subtitleConfigurations)
// ve manifestte olmayan etiketleri yutuyor. Cozum: master playlist'i yeniden yazip
// (SUBTITLES renditionlari + AUDIO NAME/LANGUAGE duzeltmesi + mutlak URI'ler)
// java.net.ServerSocket ile 127.0.0.1'den servis etmek. Cleartext acik oldugundan calisir.

// ---------------- yerel playlist sunucusu ----------------
// Uygulama HLS yolunda (HlsMediaSource.Factory) yan altyazilari (subtitleConfigurations)
// ve manifestte olmayan etiketleri yutuyor. Cozum: master playlist'i yeniden yazip
// java.net.ServerSocket ile 127.0.0.1'den servis etmek. Cleartext acik oldugundan calisir.
// Istek govdesi/path okunmaz: her slot kendi portunu acar, gelen her istege ayni
// guncel govde doner (kanitlanmis calisan desen). Slotlar bolum degisince govdesi
// guncellenir; soket/thread sizinti yok.

var DM_SLOTS = {};

// idx -> tek playlist servis eden yerel soket; donen URL "http://127.0.0.1:<port>/x.m3u8"
function dmServeSlot(idx, body) {
    var e = DM_SLOTS[idx];
    if (e) { e.body = body; return "http://127.0.0.1:" + e.port + "/x.m3u8"; }
    if (typeof Packages === "undefined") return null;
    try {
        var ss = new Packages.java.net.ServerSocket(0, 50, Packages.java.net.InetAddress.getByName("127.0.0.1"));
        var slot = { port: ss.getLocalPort(), body: body };
        DM_SLOTS[idx] = slot;
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
    } catch (e) { log("dizimag yerel sunucu:", e); return null; }
}

// video ilk PTS'si (sifreli TS segmenti cozulup ffprobe ile olculdu: start_time=1.483)
// VTT'de X-TIMESTAMP-MAP yoksa oynatici cue'lari initPTS kadar ERKEN gosterir
var DM_SUB_MPEGTS = 133470; // 1.483s * 90000

// VTT basligina X-TIMESTAMP-MAP ekle -> cue'lar video PTS eksenine hizalanir
function dmInjectTsMap(vtt, mpegts) {
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

// HLS SUBTITLES rendition'i m3u8 playlist ister; sub.php duz VTT dondugu icin
// tek segmentli bir playlist sarariz. dur: video suresi (saniye).
function dmSubPlaylist(srcUrl, dur) {
    var d = Math.ceil(dur || 7200);
    return "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:" + d +
        "\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n" +
        "#EXTINF:" + d + ".000,\n" + srcUrl + "\n#EXT-X-ENDLIST\n";
}

// goreli URI'yi playlist base'ine gore mutlak yap
function dmAbs(base, u) {
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

// master playlist'i yeniden yazar:
//  - AUDIO rendition NAME/LANGUAGE'i __PLAYER__.audios[i] ile esler (site oynaticisi da
//    index ile esliyor; manifestteki ham "audio_1" etiketi yerine "Türkçe" yazar)
//  - subs[i].src -> SUBTITLES rendition URI'si (localhost slot adresi)
//  - goreli URI'leri mutlak yapar (localhost'tan servis edildigi icin sart)
function dmRewritePlaylist(master, streamUrl, audios, subs) {
    var lines = master.split("\n");
    var out = [];
    var ai = 0, subsDone = false;
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].replace(/\r$/, "");
        if (ln.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") === 0) {
            var meta = audios && audios[ai]; ai++;
            if (meta) {
                var label = String(meta.label || meta.lang || meta.name || "Ses").replace(/"/g, "'");
                var lang = String(meta.lang || "").replace(/"/g, "");
                ln = /NAME="/.test(ln) ? ln.replace(/NAME="[^"]*"/, 'NAME="' + label + '"')
                     : ln.replace(/,URI=/, ',NAME="' + label + '",URI=');
                if (lang) ln = /LANGUAGE="/.test(ln) ? ln.replace(/LANGUAGE="[^"]*"/, 'LANGUAGE="' + lang + '"')
                     : ln.replace(/,URI=/, ',LANGUAGE="' + lang + '",URI=');
            }
        }
        ln = ln.replace(/URI="([^"]*)"/g, function (m, u) {
            return u.indexOf("http") === 0 ? m : 'URI="' + dmAbs(streamUrl, u) + '"';
        });
        if (ln.indexOf("#EXT-X-STREAM-INF") === 0) {
            if (!subsDone && subs && subs.length) {
                for (var s = 0; s < subs.length; s++) {
                    var sl = String(subs[s].label || subs[s].lang || "Altyazi").replace(/"/g, "'");
                    var slang = String(subs[s]._lang || subs[s].lang || "").replace(/"/g, "");
                    out.push('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="' + sl + '"' +
                        (slang ? ',LANGUAGE="' + slang + '"' : '') +
                        ',DEFAULT=NO,AUTOSELECT=' + (s === 0 ? "YES" : "NO") + ',FORCED=NO,URI="' +
                        subs[s].src + '"');
                }
                subsDone = true;
            }
            if (subsDone && ln.indexOf("SUBTITLES=") < 0) ln += ',SUBTITLES="subs"';
        } else if (ln.length && ln.charAt(0) !== "#" && ln.indexOf("http") !== 0) {
            ln = dmAbs(streamUrl, ln);
        }
        out.push(ln);
    }
    return out.join("\n");
}

var provider = {
    name: "Dizimag (JS)",
    mainUrl: "https://ddizimag.com",
    lang: "tr",
    supportedTypes: ["TvSeries", "Movie"],
    mainPage: [
        // ana sayfa isimli bolumleri (sec): sayfadan h2.section-title'a gore kart toplanir
        { name: "Trend Diziler", url: "/", sec: "Trend Diziler", kind: "series" },
        { name: "Son Eklenen Diziler", url: "/", sec: "Son Eklenen Diziler", kind: "series" },
        { name: "Son Eklenen Bölümler", url: "/", sec: "Son Eklenen Bölümler", kind: "episode" },
        { name: "Trend Filmler", url: "/", sec: "Trend Filmler", kind: "movie" },
        { name: "Son Eklenen Filmler", url: "/", sec: "Son Eklenen Filmler", kind: "movie" },
        { name: "Trend Animeler", url: "/", sec: "Trend Animeler", kind: "series" },
        { name: "Son Eklenen Animeler", url: "/", sec: "Son Eklenen Animeler", kind: "series" },
        { name: "Son Eklenen Anime Bölümleri", url: "/", sec: "Son Eklenen Anime Bölümleri", kind: "episode" },
        // tum liste sayfalari: ?page=N sayfalamali
        { name: "Diziler", url: "/diziler", kind: "series" },
        { name: "Filmler", url: "/filmler", kind: "movie" },
        { name: "Animeler", url: "/animes", kind: "series" }
    ],

    fixUrl: function (u) {
        if (!u) return u;
        u = String(u);
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        if (u.indexOf("/") === 0) return this.mainUrl + u;
        return this.mainUrl + "/" + u;
    },

    // ---------------- kart cozuculer ----------------

    // a.group.block icerisindeki dizi/film/anime karti
    card: function (el, kind) {
        var url = attr(el, "href") || "";
        if (kind === "episode") {
            var sm = /sezon-(\d+)\/bolum-(\d+)/.exec(url);
            var nm = txt(sel(el, "h3")[0]) || txt(sel(el, "h3.truncate")[0]) || "";
            var img = sel(el, "img")[0];
            var se = sm ? (parseInt(sm[1], 10) + ". Sezon " + parseInt(sm[2], 10) + ". Bölüm") : "";
            if (!se) {
                var ps = sel(el, "p");
                for (var pi = 0; pi < ps.length; pi++) {
                    var pt = txt(ps[pi]) || "";
                    if (pt.indexOf("Bölüm") >= 0) { se = pt.split("·")[0].trim(); break; }
                }
            }
            return {
                name: se ? nm + " " + se : nm,
                url: url,
                posterUrl: img ? attr(img, "src") : null,
                type: "TvSeries"
            };
        }
        var img2 = sel(el, "img")[0];
        var name = txt(sel(el, "h3")[0]) || (img2 ? String(attr(img2, "alt") || "").replace(/\s+(Dizi|Film|Anime)?\s*izle.*$/i, "").trim() : "");
        var isMovie = url.indexOf("/film/") >= 0 || sel(el, ".badge-film").length > 0;
        var ytxt = txt(sel(el, "p")[0]) || "";
        return {
            name: name,
            url: url,
            posterUrl: img2 ? attr(img2, "src") : null,
            year: parseInt(re(ytxt, "(?:19|20)\\d{2}"), 10) || null,
            rating: parseFloat(txt(sel(el, ".badge-rating")[0])) || null,
            type: isMovie ? "Movie" : "TvSeries"
        };
    },

    // /dizi/<slug> | /film/<slug> | /anime/<slug> kok linkleri (bolum linkleri haric)
    mediaCards: function (d) {
        var out = sel(d, 'a[href*="/dizi/"], a[href*="/film/"], a[href*="/anime/"]') || [];
        var res = [];
        for (var i = 0; i < out.length; i++) {
            var h = attr(out[i], "href") || "";
            if (!/\/(dizi|film|anime)\/[^/?#]+$/.test(h)) continue; // sezon/bolum linklerini at
            res.push(out[i]);
        }
        return res;
    },

    // ana sayfadaki isimli <section> icindeki kartlar
    sectionCards: function (d, title) {
        var secs = sel(d, "section") || [];
        for (var i = 0; i < secs.length; i++) {
            var h2 = sel(secs[i], "h2.section-title")[0];
            if (!h2 || txt(h2).trim() !== title) continue;
            return sel(secs[i], 'a[href*="bolum-"], a.group.block') || [];
        }
        return [];
    },

    getMainPage: function (page, req) {
        var cfg = null;
        for (var i = 0; i < this.mainPage.length; i++) {
            if (this.mainPage[i].name === req.name) cfg = this.mainPage[i];
        }
        if (!cfg) return { items: [], hasNext: false };

        var u = req.data || cfg.url;
        if (page > 1) u += (u.indexOf("?") >= 0 ? "&" : "?") + "page=" + page;
        var d = getDoc(this.fixUrl(u));
        if (!d) return { items: [], hasNext: false };

        var cards = cfg.sec ? this.sectionCards(d, cfg.sec) : this.mediaCards(d);
        var seen = {}, list = [];
        for (var j = 0; j < cards.length; j++) {
            var c = this.card(cards[j], cfg.kind);
            if (c && c.name && c.url && !seen[c.url]) { seen[c.url] = 1; list.push(c); }
        }
        var hasNext = !cfg.sec && sel(d, 'a[rel="next"], a[href*="page=' + (page + 1) + '"]').length > 0;
        return { items: [{ name: req.name, list: list, type: cfg.kind === "movie" ? "Movie" : "TvSeries" }], hasNext: hasNext };
    },

    // ---------------- arama ----------------

    // GET /ara?q=<q> -> "Diziler|Filmler|Animeler" bolumleri (Oyuncular atilir)
    search: function (query) {
        var q = String(query || "").trim();
        if (!q) return [];
        var d = getDoc(this.fixUrl("/ara?q=" + encodeURIComponent(q)));
        if (!d) return [];
        var cards = this.mediaCards(d);
        var seen = {}, list = [];
        for (var i = 0; i < cards.length; i++) {
            var c = this.card(cards[i], "series");
            if (c && c.name && c.url && !seen[c.url]) { seen[c.url] = 1; list.push(c); }
        }
        return list;
    },

    // ---------------- detay ----------------

    // ld+json bloklarini bulup @graph'i duzlestirir
    ldJsons: function (h) {
        var out = [];
        var rx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, m;
        while ((m = rx.exec(h))) {
            var j = null;
            try { j = JSON.parse(m[1].trim()); } catch (e) { continue; }
            var stack = [j];
            while (stack.length) {
                var it = stack.pop();
                if (!it || typeof it !== "object") continue;
                if (typeof it.length === "number" && !it["@type"]) {
                    for (var k = 0; k < it.length; k++) stack.push(it[k]);
                    continue;
                }
                out.push(it);
                var g = it["@graph"];
                if (g && typeof g.length === "number") {
                    for (var k2 = 0; k2 < g.length; k2++) stack.push(g[k2]);
                }
            }
        }
        return out;
    },

    mediaFromLd: function (lds) {
        for (var i = 0; i < lds.length; i++) {
            var t = lds[i] && lds[i]["@type"];
            if (t === "TVSeries" || t === "Movie") return lds[i];
        }
        return null;
    },

    // bir sayfadaki /sezon-N/bolum-M linklerini cikarir
    episodesFromHtml: function (h) {
        var out = [], seen = {};
        var m, rx = /\/(dizi|anime)\/[a-z0-9-]+\/sezon-(\d+)\/bolum-(\d+)/g;
        while ((m = rx.exec(h))) {
            var p = m[0];
            if (seen[p]) continue;
            seen[p] = 1;
            out.push({
                data: this.fixUrl(p),
                name: parseInt(m[3], 10) + ". Bölüm",
                season: parseInt(m[2], 10),
                episode: parseInt(m[3], 10)
            });
        }
        return out;
    },

    // sezon secici linkleri: /dizi/<slug>?sezon=N
    seasonLinks: function (h) {
        var out = [], seen = {};
        var m, rx = /(?:dizi|anime)\/[a-z0-9-]+\?sezon=(\d+)/g;
        while ((m = rx.exec(h))) {
            var n = parseInt(m[1], 10);
            if (!seen[n]) { seen[n] = 1; out.push(n); }
        }
        out.sort(function (a, b) { return a - b; });
        return out;
    },

    load: function (url) {
        url = this.fixUrl(url);
        // bolum linkinden geldiyse dizinin kok sayfasina in
        var root = url.replace(/\/sezon-\d+\/bolum-\d+\/?$/, "");
        var h = getText(root, { "User-Agent": DM_UA });
        if (!h && root !== url) { root = url; h = getText(url, { "User-Agent": DM_UA }); }
        if (!h) return null;

        var media = this.mediaFromLd(this.ldJsons(h));
        var isMovie = root.indexOf("/film/") >= 0 || (media && media["@type"] === "Movie");
        var name = media ? (media.name || "") : "";
        if (!name) {
            name = re(h, 'property="og:title"[^>]*content="([^"]+)"')
                || re(h, 'content="([^"]+)"[^>]*property="og:title"') || "";
            name = name.replace(/\s*izle.*$/i).replace(/\s*\|.*$/, "").trim();
        }
        if (!name) name = cleanTitleDm(root);
        var poster = media && media.image ? String(media.image) :
            (re(h, 'property="og:image"[^>]*content="([^"]+)"')
                || re(h, 'content="([^"]+)"[^>]*property="og:image"'));
        var desc = media ? (media.description || "") :
            (re(h, 'property="og:description"[^>]*content="([^"]+)"')
                || re(h, 'content="([^"]+)"[^>]*property="og:description"') || "");
        var year = media ? (parseInt(media.startDate, 10) || parseInt(media.datePublished, 10) || null) : null;
        if (!year) year = parseInt(re(name, "\\((\\d{4})\\)") || re(desc, "\\((\\d{4})\\)"), 10) || null;

        var episodes = [];
        if (!isMovie) {
            episodes = this.episodesFromHtml(h);
            // diger sezonlari tek tek cek (sayfa ?sezon=N ile liste veriyor)
            var seasons = this.seasonLinks(h);
            var have = {};
            for (var i = 0; i < episodes.length; i++) have[episodes[i].season] = 1;
            for (var s = 0; s < seasons.length; s++) {
                if (have[seasons[s]]) continue;
                var hs = getText(root + "?sezon=" + seasons[s], { "User-Agent": DM_UA });
                if (!hs) continue;
                var more = this.episodesFromHtml(hs);
                for (var e = 0; e < more.length; e++) episodes.push(more[e]);
            }
            var seenEp = {}, uniq = [];
            for (var u2 = 0; u2 < episodes.length; u2++) {
                if (seenEp[episodes[u2].data]) continue;
                seenEp[episodes[u2].data] = 1;
                uniq.push(episodes[u2]);
            }
            uniq.sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
            episodes = uniq;
        }
        if (!episodes.length) {
            episodes.push({ data: root, name: isMovie ? "Film" : "İzle", season: 1, episode: 1 });
        }

        return {
            name: name.replace(/\s*\(\d{4}\)\s*$/, "").trim(),
            url: root,
            type: isMovie ? "Movie" : "TvSeries",
            posterUrl: poster,
            plot: String(desc).trim(),
            year: year,
            rating: media && media.aggregateRating ? parseFloat(media.aggregateRating.ratingValue) : null,
            tags: media && media.genre ? media.genre : null,
            dataUrl: root,
            episodes: episodes
        };
    },

    // ---------------- stream ----------------

    // sayfadan data-pv slug'i + player host'unu cikarir
    pvFromPage: function (h) {
        var slug = re(h, 'data-pv="([^"]+)"');
        if (!slug) return null;
        var host = re(h, 'src="(https?://[^/"]+)/(?:assets/js/core|e/c)\\.js')
            || "https://play2.pilavyerplay.top";
        return { slug: slug, host: host };
    },

    // s.php iframe sayfasindan window.__PLAYER__ objesini cikarir
    playerFromHtml: function (h) {
        var i = h.indexOf("window.__PLAYER__");
        if (i < 0) return null;
        var j = h.indexOf("{", i);
        if (j < 0) return null;
        var depth = 0, inStr = false, esc = false;
        for (var k = j; k < h.length; k++) {
            var c = h.charAt(k);
            if (esc) { esc = false; continue; }
            if (inStr) {
                if (c === "\\") esc = true;
                else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') inStr = true;
            else if (c === "{") depth++;
            else if (c === "}") { depth--; if (depth === 0) { try { return JSON.parse(h.substring(j, k + 1)); } catch (e) { return null; } } }
        }
        return null;
    },

    loadLinks: function (data) {
        var links = [], subs = [];
        var pageUrl = this.fixUrl(String(data).trim());
        var h = getText(pageUrl, { "User-Agent": DM_UA, "Referer": this.mainUrl + "/" });
        var pv = h ? this.pvFromPage(h) : null;
        if (!pv) {
            log("dizimag: data-pv bulunamadi:", pageUrl);
            return { links: links, subtitles: subs };
        }
        var embedUrl = pv.host + "/assets/js/s.php?s=" + encodeURIComponent(pv.slug);
        var eh = getText(embedUrl, { "User-Agent": DM_UA, "Referer": pageUrl });
        var pl = eh ? this.playerFromHtml(eh) : null;
        var stream = pl && pl.stream ? String(pl.stream).replace(/\\u0026/g, "&") : null;

        // altyazi girdileri: {sid, lang, label, src} — src sub.php proxy URL'si
        var sarr = (pl && pl.subs) || [];
        var raw = [];
        for (var i = 0; i < sarr.length; i++) {
            var su = sarr[i] && (sarr[i].src || sarr[i].url || sarr[i].file);
            if (!su) continue;
            su = String(su);
            if (su.indexOf("//") === 0) su = "https:" + su;
            else if (su.indexOf("http") !== 0) su = dmAbs(embedUrl, su);
            // VTT'yi biz cek: X-TIMESTAMP-MAP ekle (senkron) + yerel servis
            var vtt = getText(su, { "Referer": pv.host + "/", "User-Agent": DM_UA });
            if (vtt && vtt.indexOf("WEBVTT") >= 0) {
                var vu = dmServeSlot("vtt" + i, dmInjectTsMap(vtt, DM_SUB_MPEGTS));
                if (vu) su = vu;
            }
            raw.push({
                lang: sarr[i].label || sarr[i].lang || "Altyazi",
                url: su,
                src: su,
                label: sarr[i].label || sarr[i].lang || "Altyazi",
                _lang: sarr[i].lang || "",
                _tr: sarr[i].lang === "tr" ? 1 : 0,
                _def: sarr[i].default ? 1 : 0
            });
        }
        // Turkce ve varsayilan isaretli altyazi once gelsin
        raw.sort(function (x, y) { return (y._def - x._def) || (y._tr - x._tr); });
        var seenSub = {};
        for (var s = 0; s < raw.length; s++) {
            if (seenSub[raw[s].url]) { raw.splice(s, 1); s--; continue; }
            seenSub[raw[s].url] = 1;
            subs.push({ lang: raw[s].lang, url: raw[s].url });
        }

        var auds = (pl && pl.audios) || [];
        var audNames = [];
        for (var a = 0; a < auds.length; a++) {
            var al = String(auds[a].label || auds[a].lang || auds[a].name || "").trim();
            if (al) audNames.push(al);
        }
        var linkName = "Dizimag " + ((pl && pl.title) || "Pilavyer");
        if (audNames.length > 1) linkName += " [Ses: " + audNames.join(" + ") + "]";

        // Yeniden yazilmis master playlist'i localhost'tan servis et (altyazi+ses etiketleri)
        var localUrl = null;
        if (stream && stream.indexOf("http") === 0) {
            var master = getText(stream, { "User-Agent": DM_UA, "Referer": pv.host + "/" });
            if (master && master.indexOf("#EXTM3U") >= 0) {
                // her altyazi icin kendi portunda tek-segmentli m3u8 (sub.php duz VTT dondurur)
                var localSubs = [];
                for (var sp = 0; sp < raw.length; sp++) {
                    var su2 = dmServeSlot("sub" + sp, dmSubPlaylist(raw[sp].src, pl.dur));
                    if (su2) localSubs.push({ label: raw[sp].label, _lang: raw[sp]._lang, src: su2 });
                }
                var mb = dmRewritePlaylist(master, stream, auds, localSubs);
                localUrl = dmServeSlot("master", mb);
            }
        }
        if (localUrl) {
            links.push({
                url: localUrl,
                name: linkName + " (Altyazı+Ses)",
                source: this.name,
                referer: pv.host + "/",
                headers: { "Referer": pv.host + "/", "User-Agent": DM_UA },
                isM3u8: true,
                hasAudio: true,
                type: "hls"
            });
        }
        if (stream && stream.indexOf("http") === 0) {
            links.push({
                url: stream,
                name: linkName,
                source: this.name,
                referer: pv.host + "/",
                headers: { "Referer": pv.host + "/", "User-Agent": DM_UA },
                isM3u8: true,
                hasAudio: true,
                type: "hls"
            });
        } else if (!localUrl) {
            // stream cozulemezse iframe'i embed olarak birak
            links.push({ url: embedUrl, name: "Dizimag Pilavyer", source: this.name, referer: pageUrl, type: "embed" });
        }

        log("dizimag loadLinks:", pageUrl, "| link:", links.length, "| sub:", subs.length, "| ses:", audNames.join(","), "| yerel:", localUrl ? "ok" : "yok");
        return { links: links, subtitles: subs };
    }
};

function cleanTitleDm(url) {
    var s = String(url || "");
    var m = /\/(?:dizi|film|anime)\/([^/?#]+)/.exec(s);
    s = m ? m[1] : s;
    return s.replace(/-(\d+)-sezon-(\d+)-bolum.*$/, " $1x$2").replace(/-/g, " ").trim();
}
