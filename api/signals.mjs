const MARKET_QUERY = {
  Global: '',
  APAC: '(sourcecountry:japan OR sourcecountry:southkorea OR sourcecountry:hongkong OR sourcecountry:singapore OR sourcecountry:malaysia OR sourcecountry:thailand OR sourcecountry:vietnam OR sourcecountry:taiwan OR sourcecountry:indonesia OR sourcecountry:india OR sourcecountry:philippines OR sourcecountry:australia OR sourcecountry:newzealand)',
  Japan: 'sourcecountry:japan',
  'South Korea': 'sourcecountry:southkorea',
  'Hong Kong': 'sourcecountry:hongkong',
  Singapore: 'sourcecountry:singapore',
  Malaysia: 'sourcecountry:malaysia',
  Thailand: 'sourcecountry:thailand',
  Vietnam: 'sourcecountry:vietnam',
  Taiwan: 'sourcecountry:taiwan',
  Indonesia: 'sourcecountry:indonesia',
  India: 'sourcecountry:india',
  'The Philippines': 'sourcecountry:philippines',
  Australia: 'sourcecountry:australia',
  'New Zealand': 'sourcecountry:newzealand'
};

const LENS_QUERY = {
  Everything: '(culture OR fashion OR music OR film OR entertainment OR gaming OR food OR travel OR design OR lifestyle OR technology OR "social media" OR creator OR beauty OR sport)',
  'Visual culture': '(design OR photography OR art OR aesthetic OR visual OR fashion OR architecture OR illustration)',
  Fashion: '(fashion OR style OR streetwear OR luxury OR beauty)',
  Food: '(food OR restaurant OR dining OR cuisine OR chef OR beverage)',
  Technology: '(technology OR AI OR gaming OR gadget OR app OR startup)',
  Entertainment: '(music OR film OR television OR streaming OR celebrity OR gaming OR anime)',
  Travel: '(travel OR tourism OR hotel OR airline OR destination OR adventure)',
  Brands: '(brand OR advertising OR campaign OR marketing OR retail OR consumer)'
};

const STOP = new Set(`the a an and or but if to of in on for with from at by as is are was were be been being this that these those it its their his her our your new latest says say after before about into over under amid among more most less than how why what when where who has have had will would could should can may might not no up out off first last today yesterday tomorrow year years week weeks day days live update report reports news world people one two three just now through against around between during via per also still get gets got make makes made take takes took big top best much many some any all other another same such own ever every local national international global market markets company companies government governments president prime minister minister police court official officials state states city cities country countries'.split(/\s+/));

function cleanTitle(title='') {
  return title.replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/,'').replace(/[^\p{L}\p{N}\s&'-]/gu,' ').replace(/\s+/g,' ').trim();
}

function keyPhrases(title) {
  const words = cleanTitle(title).split(' ').map(w=>w.trim()).filter(Boolean);
  const usable = words.filter(w => w.length > 2 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));
  const phrases = [];
  for (let i=0;i<usable.length;i++) {
    const w=usable[i];
    if (/^[A-Z\p{Lu}]/u.test(w) || w.length>=5) phrases.push(w);
    if (i < usable.length-1) {
      const b=`${usable[i]} ${usable[i+1]}`;
      if (b.length<42) phrases.push(b);
    }
  }
  return [...new Set(phrases)];
}

function parseDate(value) {
  if (!value) return null;
  const s=String(value);
  if (/^\d{14}$/.test(s)) return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`);
  const d=new Date(s); return isNaN(d) ? null : d;
}

function buildSignals(articles) {
  const now=Date.now(), day=24*3600*1000;
  const map=new Map();
  for (const a of articles) {
    const dt=parseDate(a.seendate || a.date || a.datetime) || new Date(now);
    const age=now-dt.getTime();
    const recent=age<=day;
    for (const phrase of keyPhrases(a.title)) {
      const k=phrase.toLowerCase();
      if (!map.has(k)) map.set(k,{name:phrase,recent:0,previous:0,articles:[],domains:new Set()});
      const s=map.get(k); recent ? s.recent++ : s.previous++;
      if (s.articles.length<4) s.articles.push({title:a.title,url:a.url,domain:a.domain || '',sourcecountry:a.sourcecountry || '',date:dt.toISOString()});
      if (a.domain) s.domains.add(a.domain);
    }
  }
  return [...map.values()]
    .filter(s=>s.recent>=2 && (s.recent+s.previous)>=2)
    .map(s=>{
      const ratio=(s.recent+1)/(s.previous+1);
      const breadth=Math.min(1,s.domains.size/4);
      const momentum=Math.round(Math.min(100, 35 + s.recent*8 + Math.max(0,ratio-1)*15 + breadth*15));
      const novelty=Math.round(Math.min(100, 45 + Math.max(0,ratio-1)*22 + Math.max(0,4-s.previous)*5));
      return {name:s.name,momentum,novelty,recent:s.recent,previous:s.previous,ratio:+ratio.toFixed(2),sources:s.domains.size,articles:s.articles};
    })
    .sort((a,b)=>(b.momentum+b.novelty)-(a.momentum+a.novelty))
    .slice(0,10);
}

export default async function handler(req,res) {
  try {
    const url=new URL(req.url, 'https://example.com');
    const market=url.searchParams.get('market') || 'Global';
    const lens=url.searchParams.get('lens') || 'Everything';
    const marketQ=MARKET_QUERY[market] ?? '';
    const lensQ=LENS_QUERY[lens] ?? LENS_QUERY.Everything;
    const query=[lensQ,marketQ].filter(Boolean).join(' ');
    const api=new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    api.searchParams.set('query',query);
    api.searchParams.set('mode','artlist');
    api.searchParams.set('maxrecords','200');
    api.searchParams.set('timespan','48h');
    api.searchParams.set('sort','datedesc');
    api.searchParams.set('format','json');
    const r=await fetch(api,{headers:{'User-Agent':'ZeitgeistRadar/1.0'}});
    if (!r.ok) throw new Error(`GDELT ${r.status}`);
    const data=await r.json();
    const articles=Array.isArray(data.articles) ? data.articles : [];
    const signals=buildSignals(articles);
    res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=3600');
    res.status(200).json({market,lens,generatedAt:new Date().toISOString(),source:'GDELT DOC 2.0',articleCount:articles.length,signals});
  } catch (e) {
    res.status(500).json({error:e.message || 'Unable to fetch live signals'});
  }
}
