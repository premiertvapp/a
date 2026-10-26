#!/usr/bin/env node
/**
 * PapazSports kanal/maç verisi çekici
 * Kullanım:
 *   node scraper.js                -> kanal + maç listesi (JSON, stdout)
 *   node scraper.js --streams      -> her kanal için yayın URL'i de çöz
 *   node scraper.js --out data.json -> dosyaya yaz
 */

const BASE = process.env.SITE_URL || "https://www.papazsports1032.pro";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const headers = (extra = {}) => ({
  "User-Agent": UA,
  Referer: BASE + "/",
  ...extra,
});

/** Bir HTML etiketindeki tüm data-* özniteliklerini nesne olarak çıkar */
function parseDataAttrs(tag) {
  const out = {};
  const re = /data-([a-z_-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(tag)) !== null) {
    out[m[1].toLowerCase()] = m[3] !== undefined ? m[3] : m[4];
  }
  return out;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchPage() {
  const res = await fetch(BASE + "/", { headers: headers() });
  if (!res.ok) throw new Error(`Ana sayfa alınamadı: HTTP ${res.status}`);
  return res.text();
}

/** phptojs = {...} bloğundan site ayarlarını al (tek tırnaklı JS objesi, JSON değil) */
function parsePhpToJs(html) {
  const grab = (key, def) => {
    const m = html.match(new RegExp(`'${key}'\\s*:\\s*'([^']*)'`));
    return m ? m[1] : def;
  };
  return {
    stream_server_cdn_url: grab("stream_server_cdn_url", "/"),
    site_name: grab("site_name", "PapazSports"),
  };
}

/** #tv-listesi ve #channel-slider içindeki kanalları çıkar */
function parseChannels(html) {
  const seen = new Set();
  const channels = [];
  const re = /<(?:li|div)\b[^>]*data-target="viptv"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const a = parseDataAttrs(m[0]);
    const src = a["source"];
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const imgM = html.slice(m.index, m.index + 600).match(/<img[^>]*src="([^"]+)"/i);
    channels.push({
      id: src,
      name: a["name"] || a["search"] || "",
      slug: (a["url"] || "").replace(/^#/, ""),
      logo: imgM ? new URL(imgM[1], BASE).href : null,
      type: "viptv",
    });
  }
  return channels;
}

/** #mac-listesi içindeki maçları çıkar */
function parseMatches(html) {
  const section = html.match(/<ul class="match-list">([\s\S]*?)<\/ul>/);
  if (!section) return [];
  // data-name="<span>...</span>" gibi '>' içeren öznitelikler için tırnak-aware eşleşme
  const re = /<li\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/li>/gi;
  const matches = [];
  let m;
  while ((m = re.exec(section[1])) !== null) {
    const a = parseDataAttrs(m[1]);
    if (!a["source"]) continue;
    let sources = [];
    try {
      sources = JSON.parse(a["source"]);
    } catch {}
    const time = m[2].match(/<span class="saat">([^<]+)<\/span>/i);
    const searchParts = (a["search"] || "").split(/\s{2,}/);
    matches.push({
      name: stripTags(a["name"] || ""),
      category: a["category"] || "",
      league: searchParts.length > 1 ? searchParts[searchParts.length - 1] : "",
      time: time ? time[1].trim() : null,
      slug: (a["url"] || "").replace(/^#/, ""),
      mackolikId: a["mackolik"] || null,
      homeLogo: a["home_logo"] || null,
      awayLogo: a["away_logo"] || null,
      sources, // [{ad:"SD", tip:"vip", link: 123}]
    });
  }
  return matches;
}

/**
 * Yayın çözümleyici — sitenin script.js'indeki generateStream() ile aynı mantık:
 *   viptv (kanal): POST auth.php  channel=<id>
 *   vip   (maç)  : POST auth.php  id=<link>
 * Dönen {URL, TOKEN, SERVER}; URL token header'larıyla açılan bir m3u8.
 */
async function resolveStream(tip, id, cfg) {
  const body = tip === "viptv" ? `channel=${id}` : `id=${id}`;
  const res = await fetch(
    new URL(cfg.stream_server_cdn_url + "auth.php", BASE).href,
    {
      method: "POST",
      headers: headers({
        Origin: BASE,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
      }),
      body,
    }
  );
  const data = await res.json();
  if (data.ERROR) throw new Error(data.ERROR);
  return {
    url: data.URL, // m3u8 playlist (uzantısı .js olabilir)
    token: data.TOKEN,
    server: data.SERVER,
    // Playlist'i indirirken/oynatırken gerekli header'lar:
    requiredHeaders: { usertoken: data.TOKEN, pl: cfg.site_name },
  };
}

async function main() {
  const wantStreams = process.argv.includes("--streams");
  const outIdx = process.argv.indexOf("--out");
  const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;

  const html = await fetchPage();
  const cfg = parsePhpToJs(html);
  const channels = parseChannels(html);
  const matches = parseMatches(html);

  const result = { site: BASE, fetchedAt: new Date().toISOString(), channels, matches };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (wantStreams) {
    console.error(`[i] ${channels.length} kanal + ${matches.length} maç için yayın çözülüyor...`);
    for (const ch of result.channels) {
      try {
        ch.stream = await resolveStream("viptv", ch.id, cfg);
      } catch (e) {
        ch.stream = { error: e.message };
      }
      await sleep(300); // nazik bekleme
    }
    for (const match of result.matches) {
      match.streams = [];
      for (const s of match.sources) {
        try {
          match.streams.push({ label: s.ad, ...(await resolveStream(s.tip, s.link, cfg)) });
          break; // ilk çalışan kaynak yeterli
        } catch (e) {
          match.streams.push({ label: s.ad, error: e.message });
        }
        await sleep(300);
      }
    }
  }

  const json = JSON.stringify(result, null, 2);
  if (outFile) {
    (await import("node:fs")).writeFileSync(outFile, json, "utf8");
    console.error(`[✓] ${channels.length} kanal, ${matches.length} maç -> ${outFile}`);
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  console.error("Hata:", e.message);
  process.exit(1);
});
