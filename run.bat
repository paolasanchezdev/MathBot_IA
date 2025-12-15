@echo off
title MathBot.IA - Backend + Frontend
echo ================================
echo Iniciando MathBot.IA...
echo ================================
echo.

cd backend

if not exist env (
    echo [INFO] Creando entorno virtual...
    python -m venv env
)

call env\Scripts\activate

if exist requirements.txt (
    echo [INFO] Verificando dependencias del backend...
    python -c "import sys,re,json,subprocess;reqs=[l.strip() for l in open('requirements.txt','r',encoding='utf-8') if l.strip() and not l.strip().startswith('#')];pat=re.compile(r'^([A-Za-z0-9_.-]+)');names=[pat.match(l).group(1).lower() for l in reqs if pat.match(l)];installed=set(d['name'].lower() for d in json.loads(subprocess.check_output([sys.executable,'-m','pip','list','--format','json']).decode('utf-8')));missing=[n for n in names if n not in installed];print('MISSING:'+','.join(missing) if missing else 'ALL_PRESENT');sys.exit(1 if missing else 0)"
    if errorlevel 1 (
        echo [INFO] Faltan dependencias: instalando con pip...
        python -m pip install -r requirements.txt
    ) else (
        echo [INFO] Dependencias presentes. Omitiendo pip install.
    )
)

echo [INFO] Iniciando backend en http://127.0.0.1:8000 ...
start cmd /k "python -m uvicorn main:app --reload --port 8000"

cd ..
cd frontend

echo [INFO] Abriendo navegador en http://127.0.0.1:5500/index.html ...
start http://127.0.0.1:5500/index.html

echo [INFO] Iniciando frontend en http://127.0.0.1:5500 ...
python -m http.server 5500

pause
