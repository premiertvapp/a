


function getJson(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        if (!r || r.code !== 200 || !r.text) return null;
        var t = r.text.trim();
        if (t.indexOf("<") === 0) return null;   // HTML geldiyse JSON degil
        return JSON.parse(t);
    } catch (e) { return null; }
}


function getText(url, headers) {
    try {
        var r = http(url, { method: "GET", headers: headers || {} });
        return (r && r.code === 200) ? r.text : null;
    } catch (e) { return null; }
}


var provider = {
    name: "Tabii TV (JS)",
    mainUrl: "https://www.tabii.com",
    logoCdn: "https://cms-tabii-public-image.tabii.com/int/",
    lang: "tr",
    supportedTypes: ["Live"],
    mainPage: [
        { name: "Tabii", url: "api", kind: "spor" },
        { name: "TRT Kanalları", url: "api", kind: "tv" }
    ],


    // ana sayfadan buildId cikar
    buildId: function (html) {
        return re(html, '"buildId":"([^"]+)"')
            || re(html, "/_next/static/chunks/([^/]+)/")
            || re(html, "/_next/data/([^/]+)/");
    },


    // canli sayfa html'inden __NEXT_DATA__ -> liveChannels
    channelsFromHtml: function (html) {
        var m = html && html.match(/__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
        if (!m) return [];
        try {
            var j = JSON.parse(m[1]);
            var lc = j.props && j.props.pageProps && j.props.pageProps.liveChannels;
            return lc || [];
        } catch (e) { return []; }
    },


    // tabii.com kanal listesi -> [{id,title,slug,logo,urls[]}]
    fetchChannels: function () {
        var livePage = this.mainUrl + "/tr/watch/live/trt1";
        var html = getText(livePage);
        var raw = [];


        var bid = html ? this.buildId(html) : null;
        if (bid) {
            var api = this.mainUrl + "/_next/data/" + bid + "/tr/watch/live/trtspor.json?trackId=150022&slug=trtspor";
            var j = getJson(api, {
                "x-nextjs-data": "1",
                "Referer": livePage
            });
            if (j && j.pageProps && j.pageProps.liveChannels) raw = j.pageProps.liveChannels;
        }
        if (!raw.length && html) raw = this.channelsFromHtml(html);
        if (!raw.length) {
            // son care: farkli bir live slug ile tekrar dene
            html = getText(this.mainUrl + "/tr/watch/live/trtspor");
            raw = html ? this.channelsFromHtml(html) : [];
        }


        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var c = raw[i];
            var logo = null;
            var imgs = c.images || [];
            for (var k = 0; k < imgs.length; k++) {
                if (imgs[k].imageType === "logo" && imgs[k].name) { logo = this.logoCdn + imgs[k].name; break; }
            }
            var urls = [];
            var media = c.media || [];
            for (var m = 0; m < media.length; m++) {
                var u = media[m];
                if (u.type === "hls" && u.drmSchema === "clear" && u.url && u.url.indexOf(".m3u8") >= 0) urls.push(u.url);
            }
            if (urls.length) {
                out.push({ id: c.id, title: c.title, slug: c.slug, logo: logo, urls: urls });
            }
        }
        return out;
    },


    isSpor: function (title) { return /spor/i.test(title); },


    // spor siralamasi: numarali tabii spor kanallari once, sonra digerleri
    sortSpor: function (a, b) {
        var na = parseInt((a.title.match(/\d+/) || ["99"])[0]);
        var nb = parseInt((b.title.match(/\d+/) || ["99"])[0]);
        if (na !== nb) return na - nb;
        return a.title < b.title ? -1 : 1;
    },
    sortAlpha: function (a, b) { return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0); },


    card: function (c) {
        return {
            name: c.title,
            url: this.mainUrl + "/tr/watch/live/" + c.slug,
            posterUrl: c.logo,
            type: "Live"
        };
    },


    getMainPage: function (page, req) {
        var cfg = null;
        var mp = this.mainPage;
        for (var i = 0; i < mp.length; i++) if (mp[i].name === req.name) cfg = mp[i];
        if (!cfg) return { items: [], hasNext: false };
        var all = this.fetchChannels();
        var list = [];
        var spor = cfg.kind === "spor";
        for (var j = 0; j < all.length; j++) {
            if (this.isSpor(all[j].title) === spor) list.push(this.card(all[j]));
        }
        if (spor) {
            // kart adlarina gore numarali siralama
            list.sort(function (a, b) {
                var na = parseInt((a.name.match(/\d+/) || ["99"])[0]);
                var nb = parseInt((b.name.match(/\d+/) || ["99"])[0]);
                return na !== nb ? na - nb : (a.name < b.name ? -1 : 1);
            });
        } else {
            list.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
        }
        return { items: [{ name: req.name, list: list, type: "Live" }], hasNext: false };
    },


    search: function (query) {
        var q = query.toLowerCase();
        var all = this.fetchChannels();
        var list = [];
        for (var i = 0; i < all.length; i++) {
            if (all[i].title.toLowerCase().indexOf(q) >= 0) list.push(this.card(all[i]));
        }
        return list;
    },


    load: function (url) {
        var slug = re(url, "/live/([^/?#]+)");
        if (!slug) return null;
        var all = this.fetchChannels();
        var c = null;
        for (var i = 0; i < all.length; i++) {
            if (all[i].slug === slug) { c = all[i]; break; }
        }
        if (!c) return null;
        var data = JSON.stringify({ slug: c.slug, title: c.title, urls: c.urls });
        return {
            name: c.title,
            url: url,
            type: "Live",
            posterUrl: c.logo,
            plot: "Tabii canlı yayın — " + c.title,
            dataUrl: data,
            episodes: [{ data: data, name: "Canlı Yayın", season: 1, episode: 1 }]
        };
    },


    loadLinks: function (data) {
        var links = [];
        var c = null;
        try { c = JSON.parse(data); } catch (e) { c = null; }
        var urls = (c && c.urls) || [];
        var title = (c && c.title) || "Tabii";
        for (var i = 0; i < urls.length; i++) {
            links.push({
                url: urls[i],
                name: "Tabii " + title + (urls.length > 1 ? " S" + (i + 1) : ""),
                source: this.name,
                referer: this.mainUrl + "/",
                headers: { "Referer": this.mainUrl + "/" },
                isM3u8: true,
                type: "hls"
            });
        }
        // data bozuksa slug'dan tekrar coz
        if (!links.length && c && c.slug) {
            var all = this.fetchChannels();
            for (var j = 0; j < all.length; j++) {
                if (all[j].slug === c.slug) {
                    for (var k = 0; k < all[j].urls.length; k++) {
                        links.push({
                            url: all[j].urls[k],
                            name: "Tabii " + all[j].title,
                            source: this.name,
                            referer: this.mainUrl + "/",
                            headers: { "Referer": this.mainUrl + "/" },
                            isM3u8: true,
                            type: "hls"
                        });
                    }
                }
            }
        }
        log("loadLinks:", title, "| link:", links.length);
        return { links: links, subtitles: [] };
    }
};
