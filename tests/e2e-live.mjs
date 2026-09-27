// Live end-to-end walk of the deployed app (390x844, real TfL + Darwin data).
// Run: mkdir -p /tmp/journey-e2e && node tests/e2e-live.mjs /tmp/journey-e2e

import pw from '/opt/homebrew/lib/node_modules/playwright/index.js';
const out = process.argv[2]; const results = [];
const ok = (name, pass, info='') => { results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); };
const b = await pw.chromium.launch({channel:'chrome'});
const ctx = await b.newContext({viewport:{width:390,height:844}, geolocation:{latitude:51.405312,longitude:-0.062353}, permissions:['geolocation']});
const p = await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error' && !/favicon|moz/i.test(m.text())) errs.push(m.text()); });
const txt = async sel => (await p.$(sel)) ? (await p.$eval(sel, e => e.innerText.replace(/\s+/g,' '))) : '';
await p.goto('https://tremaine-159cf.web.app/?e2e=1',{waitUntil:'load'}); await p.waitForTimeout(3000);

// 1. Home recognised
ok('Home recognised at SE20 7UA', /Home \(SE20\)/.test(await txt('#from-text')) && /SE20/.test(await txt('#header-location')), `${await txt('#header-location')} / ${await txt('#from-text')}`);

// 2. Plan a journey, results cards
await p.fill('#destination-input','Canary Wharf'); await p.keyboard.press('Enter'); await p.waitForTimeout(12000);
const cards = await p.$$('.route-card');
ok('Journey results render', cards.length > 0, `${cards.length} options`);
const meta = await p.$$eval('.route-meta', els => els.map(e => e.innerText.replace(/\s+/g,' ')));
ok('Cards count down to leaving home', meta.length && meta.every(m => /^Leave (now|in \d+ min)/.test(m)), meta[0]);
const nt = await p.$$eval('.jp-next-trains', els => els.map(e => ({ t: e.innerText.replace(/\s+/g,' '), rows: e.querySelectorAll('[data-due]').length })));
ok('Next-trains boxes filled with live trains', nt.some(n => n.rows > 0), nt.map(n => n.rows).join('/') + ' rows');
ok('No "unavailable"/stuck boxes', nt.every(n => !/unavailable|Checking live/.test(n.t)));
await p.screenshot({path:`${out}/e2e-1-results.png`});

// 3. Journey detail
await cards[0].click(); await p.waitForTimeout(6000);
const detail = await txt('#journey-detail-content');
ok('Journey detail opens', detail.length > 50);
ok('Detail shows live next trains', /Next (trains|buses|trams) from/.test(detail) && !/unavailable/i.test(detail), (detail.match(/Next (?:trains|buses|trams) from [^·]{0,60}/)||[''])[0]);
await p.screenshot({path:`${out}/e2e-2-detail.png`, fullPage:false});

// 4. Nearby tab
await p.goto('https://tremaine-159cf.web.app/?e2e=2',{waitUntil:'load'}); await p.waitForTimeout(2000);
await p.click('.bn-btn[data-screen="nearby"]'); await p.waitForTimeout(9000);
const stations = await p.$$eval('.nearby-item[data-station-id]', els => els.map(e => e.innerText.replace(/\s+/g,' ').slice(0,120)));
ok('Nearby lists stations', stations.length > 0, stations.length + ' stations');
ok('Nearby station shows live trains', stations.some(s => /\d+ min|due/.test(s)), stations.find(s => /Anerley/.test(s)) || stations[0]);
await p.screenshot({path:`${out}/e2e-3-nearby.png`});

// 5. Station modal + Calling at + pin
const anz = await p.$('.nearby-item[data-station-name*="Anerley"]') || await p.$('.nearby-item[data-station-id]');
await anz.click(); await p.waitForTimeout(6000);
const modal = await txt('#modal-departures');
ok('Station modal shows departures', /\d{2}:\d{2}|min/.test(modal) && !/unavailable/i.test(modal), (await txt('#modal-station-name')) + ': ' + modal.slice(0,90));
const call = await p.$('#modal-departures .call-toggle[data-rid]');
if (call) { await call.click(); await p.waitForTimeout(3000); }
const afterCall = await txt('#modal-departures');
ok('"Calling at" expands with stops', !!call && /Penge West|Sydenham|Norwood|Crystal Palace/.test(afterCall), call ? '' : 'no Calling at button');
const pin = await p.$('#modal-departures .dep-pin');
if (pin) { await pin.click(); await p.waitForTimeout(2500); }
const strip = await txt('#pinned-strip');
ok('Pin a train shows status strip', !!pin && strip.length > 5, strip.slice(0,90) || 'no pin button');
await p.screenshot({path:`${out}/e2e-4-modal.png`});

// 6. From my location (away from home)
const ctx2 = await b.newContext({viewport:{width:390,height:844}, geolocation:{latitude:51.5074,longitude:-0.1278}, permissions:['geolocation']});
const p2 = await ctx2.newPage(); await p2.goto('https://tremaine-159cf.web.app/?e2e=3',{waitUntil:'load'}); await p2.waitForTimeout(6000);
const from2 = await p2.$eval('#from-text', e => e.innerText);
ok('Away from home uses GPS location', /Near/.test(from2) && !/Home/.test(from2), from2);
await p2.fill('#destination-input','Anerley'); await p2.keyboard.press('Enter'); await p2.waitForTimeout(12000);
const c2 = await p2.$$('.route-card');
ok('Routes from GPS location to Anerley', c2.length > 0, c2.length + ' options');
await ctx2.close();

ok('No JS errors on live site', errs.length === 0, errs.slice(0,3).join(' | '));
console.log(results.join('\n'));
await b.close();
