// Every pre-existing Node suite plus v3.2.3 regressions. Browsers/Postgres/HTTP run separately.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const suites=[
 'qa/gps-core-test.cjs','qa/profiles-core-test.cjs','qa/vehicle-catalog-test.cjs','qa/vehicle-integration.mjs',
 'qa/cloud-client-test.cjs','qa/cloud-sync-test.mjs','qa/google-identity-dom.cjs','qa/dom-smoke.mjs',
 'qa/connection-test.mjs','qa/sw-test.cjs','qa/business-core-test.cjs','qa/business-client-test.cjs',
 'qa/billing-test.mjs','qa/tracking-test.mjs','qa/math-audit.cjs','qa/deep-audit-data-gps-consent-test.mjs',
 'qa/deep-audit-ui-probes.mjs','qa/deep-audit-integrations-auth.cjs','qa/deep-audit-integrations-ui.mjs',
 'qa/deep-audit-integrations-invite-context.mjs','qa/deep-audit-payments-boundaries.mjs','qa/deep-audit-payments-checkout-race.mjs',
 'qa/v323/legacy-hours-test.mjs','qa/v323/backup-budget-test.cjs','qa/v323/session-client-test.cjs',
 'qa/v323/session-diagnostics-test.mjs','qa/v323/gps-lifecycle-test.mjs','qa/v323/gps-review-test.mjs','qa/v323/sync-integration-test.mjs',
 'qa/v323/device-data-test.mjs'
];
fs.mkdirSync(path.join(root,'qa/v323/evidence'),{recursive:true});
const results=[];
for(const [i,suite]of suites.entries()){
 const started=Date.now();
 const r=spawnSync(process.execPath,[suite],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 const log=(r.stdout||'')+(r.stderr||'');
 const evidence=`qa/v323/evidence/local-${String(i+1).padStart(2,'0')}.log`;
 fs.writeFileSync(path.join(root,evidence),log);
 const ok=r.status===0;
 results.push({suite,status:ok?'passed':'failed',exitCode:r.status,durationMs:Date.now()-started,
   passLines:log.split('\n').filter(line=>/^PASS\s/.test(line)).length,evidence});
 console.log(`${ok?'PASS':'FAIL'} ${suite}`);
 if(!ok)console.log(log.slice(-5000));
}
const report={classification:'automated-local-node-and-simulated-DOM',timestamp:new Date().toISOString(),
 productionMutated:false,realFinancialData:false,physicalGPS:false,
 suiteCount:results.length,passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status!=='passed').length,
 note:'passLines are log markers, not a count of unique scenarios; math fuzz and grouped assertions have different granularity.',results};
report.sourceSha256=Object.fromEntries(fs.readdirSync(root).filter(name=>/\.(js|html|css)$/.test(name)).sort()
 .map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
fs.writeFileSync(path.join(root,'qa/v323/local-suite-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({suites:report.suiteCount,passed:report.passed,failed:report.failed}));
process.exitCode=report.failed?1:0;
