#!/usr/bin/env python3
"""Read-only source inventory and runtime manifest; never reads browser storage."""
import hashlib
import json
import pathlib
import re
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = '8f4cae36367f667ca871bd2539891ad6d1a74599'
sha = lambda data: hashlib.sha256(data).hexdigest()
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)
def reason(name):
    exact = {
        'app.js':'Diagnóstico legado, avisos, taxa por hora e edição explícita, sem normalização histórica.',
        'experience.js':'Aviso e preservação de cronômetros legados acima de 24 horas.',
        'cloud-client.js':'Sessão autoritativa, renovação, logout concorrente, PT409 e repetição automática desativada.',
        'cloud-sync.js':'Preflight JSONB/legados antes do upload e estado ocupado acessível.',
        'backup-budget.js':'Orçamento conservador UTF-8/JSONB, sem mutação ou acesso a armazenamento.',
        'session-diagnostics.js':'Diagnóstico manual seguro e acessível, sem leitura de lançamentos.',
        'device-data.js':'Exportação técnica e remoção explícita protegida dos dados do perfil ativo.',
        'profiles-core.js':'Guard de geração/journal para impedir gravação antiga após remoção local.',
        'tracking.js':'Retorno de suspensão, callbacks antigos, revogação de permissão e falhas síncronas.',
        'index.html':'Carga dos três módulos novos e identificação da candidata 3.2.3.',
        'sw.js':'Cache 3.2.3 com módulos completos e escopo existente preservado.',
        'supabase/schema.sql':'Somente SQLSTATE de conflito CAS pessoal: PT409.',
        'supabase/enterprise.sql':'Somente seis SQLSTATEs de conflito em três RPCs; preserva autorização/locks/CAS.',
        'privacidade.html':'Explica gerenciamento e cópia técnica dos dados locais.',
        'exclusao-dados.html':'Distingue remoção do perfil, limpeza do navegador e exclusão da conta.',
        '.github/workflows/browser-tests.yml':'Todas as suítes, novos fluxos Chromium, HTTP local real e artefatos sanitizados.',
        '.gitignore':'Evita dependências e capturas/logs volumosos no versionamento.',
        'package.json':'Versão e comandos de validação reproduzíveis, sem mudança de dependências.',
        'package-lock.json':'Metadados da versão; versões e integridades de dependências preservadas.',
        'README.md':'Entrada para documentação, execução e limites da candidata.',
        'CHANGELOG.md':'Comportamento final e restrições da versão.'
    }
    if name in exact: return exact[name]
    if name.startswith('supabase/migrations/'): return 'Quinta migração incremental mínima; aplicação remota pendente de autorização.'
    if name.startswith('docs/v3.2.3/sql/'): return 'Rollback SQL revisável com guard; nenhum uso em produção.'
    if name.startswith('docs/'): return 'Documentação de comportamento, evidências, riscos, homologação ou rollback.'
    if name.endswith(('.json','.log')): return 'Evidência sanitizada, manifesto ou resultado de testes sintéticos/classificação explícita.'
    if name.startswith(('qa/','supabase/test')): return 'Regressão automatizada, isolamento/concorrência ou runner de validação reproduzível.'
    return 'Arquivo de suporte à candidata; revisar no diff da branch.'

doc = ROOT/'docs/v3.2.3/ARQUIVOS.md'
manifest = ROOT/'qa/v323/release-inventory.json'
doc.touch(exist_ok=True)
manifest.touch(exist_ok=True)
tracked = git('ls-files','-z').decode().split('\0')
untracked = git('ls-files','--others','--exclude-standard','-z').decode().split('\0')
names = sorted(set(name for name in tracked+untracked if name and name != 'qa/v323/work-state.json'))
changes = []
for name in names:
    p=ROOT/name
    if not p.is_file() or p.is_symlink(): continue
    result=subprocess.run(['git','show',BASE+':'+name],cwd=ROOT,capture_output=True)
    if result.returncode or result.stdout != p.read_bytes():
        changes.append({'path':name,'status':'novo' if result.returncode else 'modificado','reason':reason(name)})

sw=(ROOT/'sw.js').read_text()
paths=re.findall(r"'\./(.*?)'",sw.split('const ARQUIVOS =',1)[1].split(';',1)[0])+['sw.js']
assert len(paths)==len(set(paths))==43
runtime=[]
for name in sorted(paths):
    data=(ROOT/name).read_bytes()
    baseline=subprocess.run(['git','show',BASE+':'+name],cwd=ROOT,capture_output=True)
    runtime.append({'path':name,'sha256':sha(data),'bytes':len(data),'baselineSha256':None if baseline.returncode else sha(baseline.stdout),
        'unchangedFrom322':not baseline.returncode and data==baseline.stdout})
for name in re.findall(r'<script src="([^"]+)"', (ROOT/'index.html').read_text()):
    assert name in paths, 'Script missing from offline manifest: '+name
assert json.loads((ROOT/'package.json').read_text())['version']=='3.2.3'
lock=json.loads((ROOT/'package-lock.json').read_text())
old_lock=json.loads(git('show',BASE+':package-lock.json'))
for versioned in (lock,old_lock):
    versioned.pop('version',None)
    versioned['packages'][''].pop('version',None)
assert lock==old_lock, 'Dependency tree unexpectedly changed'

result={'baseCommit':BASE,'generatedAt':datetime.now(timezone.utc).isoformat(),'runtimeFiles':len(runtime),
 'runtime':runtime,'changedFiles':changes,'dependencyTreeUnchanged':True,'noProductionPublication':True,
 'note':'Runtime hashes exclude this inventory/document, avoiding recursive hashes. Full source is reviewed in the development branch.'}
manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
rows=['# Arquivos e justificativas — v3.2.3','',
 'Comparação com `'+BASE+'`. O manifesto `qa/v323/release-inventory.json` registra SHA-256 dos 43 arquivos de runtime e distingue os recursos preservados da referência. A árvore de dependências não mudou. Capturas e logs locais volumosos são artefatos de teste; não são código do aplicativo.','',
 '| Arquivo | Estado | Justificativa |','|---|---|---|']
rows.extend('| `'+item['path']+'` | '+item['status']+' | '+item['reason']+' |' for item in changes)
rows.extend(['','As quatro migrações históricas, estilos, arte original, modelos de dados e módulos sem mudança permanecem na árvore da referência. A quinta migração altera somente SQLSTATEs de conflitos, com prova de preservação. Nenhum arquivo listado autoriza uma operação em produção.',''])
doc.write_text('\n'.join(rows))
print(json.dumps({'changedFiles':len(changes),'runtimeFiles':43,'runtimePreserved':sum(x['unchangedFrom322'] for x in runtime),'dependencyTreeUnchanged':True}))
