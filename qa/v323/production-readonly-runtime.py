#!/usr/bin/env python3
"""Public static resources/Auth settings only. GET; no user tokens or financial endpoints."""
import concurrent.futures
import hashlib
import json
import pathlib
import re
import subprocess
import urllib.request
from datetime import datetime, timezone

ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE='8f4cae36367f667ca871bd2539891ad6d1a74599'
URL='https://lesmoboy.github.io/meu-primeiro-app/'
def original(name):
    return subprocess.check_output(['git','show',BASE+':'+name],cwd=ROOT)
def get(url,public_key=None):
    headers={'Cache-Control':'no-cache'}
    if public_key is not None: headers['apikey']=public_key
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as response:
        return response.status,response.read()
sw=original('sw.js').decode()
paths=re.findall(r"'\./(.*?)'",sw.split('const ARQUIVOS =',1)[1].split(';',1)[0])+['sw.js']
assert len(paths)==40
def inspect(name):
    status,body=get(URL+name)
    digest=hashlib.sha256(body).hexdigest()
    return {'path':name,'status':status,'sha256':digest,'matches322':body==original(name)}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results=list(pool.map(inspect,paths))
public_key=re.search(r"publishableKey\s*:\s*['\"]([^'\"]+)['\"]",(ROOT/'cloud-config.js').read_text())[1]
assert public_key.startswith('sb_publishable_')
settings_status,settings_body=get('https://ivoszoawhknwbiszjvfv.supabase.co/auth/v1/settings',public_key)
health_status,health_body=get('https://ivoszoawhknwbiszjvfv.supabase.co/auth/v1/health',public_key)
settings=json.loads(settings_body)
health=json.loads(health_body)
providers={name:settings.get('external',{}).get(name) for name in ['google','facebook','email']}
assert all(row['status']==200 and row['matches322'] for row in results)
assert providers=={'google':True,'facebook':False,'email':False}
report={'classification':'production-read-only-public-runtime-and-settings','observedAt':datetime.now(timezone.utc).isoformat(),
 'referenceCommit':BASE,'matches':len(results),'runtimeFiles':results,'authHealthStatus':health_status,
 'authVersion':health.get('version'),'publicSettingsStatus':settings_status,'providers':providers,
 'anonymousSignInEnabled':settings.get('external',{}).get('anonymous'),
 'financialRowsRead':False,'userTokensUsed':False,'productionWrites':False,'candidatePublished':False}
(ROOT/'qa/v323/production-readonly-runtime.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'runtime322HashesMatched':40,'authHealthStatus':health_status,'providers':providers,'candidatePublished':False}))
