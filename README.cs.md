# Nástroj pro ladění Playwright

Tento nástroj automatizuje ladicí relace webových aplikací tím, že kombinuje Playwright pro automatizaci prohlížeče s funkcemi AI (Gemini) pro generování akcí a analýzu snímků obrazovky. Také slučuje výstup ze skriptu orchestrátoru Python s logy Laravel pro komplexní zážitek z ladění.

## Funkce

*   **Automatizované ladění webu:** Navigujte, autentizujte a interagujte s webovými aplikacemi pomocí Playwright.
*   **Generování akcí pomocí AI:** Vytvářejte kód Playwright v JavaScriptu z instrukcí v přirozeném jazyce pomocí Gemini API.
*   **Analýza snímků obrazovky pomocí AI:** Analyzujte anotované snímky obrazovky pomocí Gemini Vision k identifikaci prvků uživatelského rozhraní a jejich CSS selektorů.
*   **Slučování logů:** Kombinuje výstup z orchestrátoru Python a logů Laravel pro jednotný pohled.
*   **Logování WebSocket:** Zachycuje a reportuje komunikaci WebSocket.
*   **Ověření perzistence relace:** Kontroluje, zda relace uživatele přetrvávají po přihlášení a tvrdém obnovení.
*   **Podpora více jazyků:** Dokumentace je k dispozici v angličtině, ruštině a češtině.

## Nastavení a závislosti

Tento nástroj je zabalen jako Docker obraz. Pro jeho spuštění potřebujete mít nainstalovaný Docker.

### Předpoklady

*   **Docker:** Ujistěte se, že máte nainstalovaný a spuštěný Docker.
*   **Gemini API Key:** Získejte API klíč z Google AI Studio ([https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)).
*   **Lokální adresář pro výsledky:** Vytvořte adresář s názvem `frontend/test-results` v kořenovém adresáři vašeho projektu (nebo upravte mapování svazků v `docker-compose.yml`), abyste mohli ukládat snímky obrazovky.

### Struktura projektu

Soubory nástroje se nacházejí v:
`/docker/frontend/dev-aiio-platform-oleg/docker/tools/playwright-debugger/`

Tento adresář obsahuje:
*   `Dockerfile`: Instrukce pro sestavení Docker obrazu.
*   `docker-compose.yml`: Definuje službu Docker pro spuštění nástroje.
*   `.env.example`: Příklad proměnných prostředí pro konfiguraci.
*   `requirements.txt`: Závislosti Pythonu.
*   `package.json`: Závislosti Node.js.
*   `run-debug-session.py`: Python skript orchestrující ladicí relaci.
*   `host-debug-editor.mjs`: Node.js skript využívající Playwright pro interakci s prohlížečem.

## Konfigurace

1.  **Vytvořte soubor `.env`:**
    Zkopírujte soubor `.env.example` do `.env` v adresáři nástroje:
    ```bash
    cp .env.example .env
    ```
2.  **Upravte `.env`:**
    Otevřte soubor `.env` a aktualizujte následující:
    *   `GEMINI_API_KEY`: Váš skutečný Gemini API klíč z [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   `GEMINI_MODEL`: (Volitelné) Model Gemini k použití (výchozí `gemini-2.5-flash-lite`).
    *   `AUTH_EMAIL`: (Volitelné) Výchozí email pro autentizaci.
    *   `AUTH_PASSWORD`: (Volitelné) Výchozí heslo pro autentizaci.
3.  **Integrace Laravel logů (Volitelné):**
    Pokud chcete monitorovat Laravel logy během ladění:
    *   Odkomentujte Laravel log volume mount v `docker-compose.yml`
    *   Upravte cestu tak, aby ukazovala na váš skutečný Laravel log soubor
    *   Používejte parametr `--laravel-log` při spouštění nástroje

## Použití

### Sestavení Docker obrazu

Přejděte do adresáře nástroje a spusťte:
```bash
docker build -t playwright-debugger .
```

### Spuštění ladicího nástroje

Použijte `docker-compose run` pro spuštění nástroje. Musíte zadat cílovou URL a případné požadované příznaky.

**Základní příkaz (bez monitorování Laravel logů):**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>"
```

**S autentizací a analýzou snímků obrazovky:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>" --auth --analyze-screenshot
```

**S instrukcemi generovanými AI:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>" --instructions "Vaše instrukce v přirozeném jazyce zde"
```

**S monitorováním Laravel logů:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "<TARGET_URL>" --auth --laravel-log "/cesta/k/laravel.log"
```

**Úplný příklad:**
```bash
docker-compose run --rm aiio-playwright-debugger-tool python3 run-debug-session.py "https://example.com" --auth --analyze-screenshot --instructions "Klikni na tlačítko přihlášení a počkej 3 sekundy"
```

### Dostupné parametry

*   `<TARGET_URL>`: URL k testování (povinné)
*   `--auth`: Povolit automatickou autentizaci pomocí přihlašovacích údajů z .env
*   `--analyze-screenshot`: Povolit AI analýzu finálního snímku obrazovky pomocí Gemini Vision
*   `--instructions "text"`: Instrukce v přirozeném jazyce pro AI pro generování Playwright akcí
*   `--laravel-log "/cesta/k/logu"`: Cesta k Laravel log souboru pro monitorování (volitelné)
*   `--wss`: Povolit logování WebSocket komunikace
*   `--verify-persistence`: Ověřit perzistenci relace po přihlášení

**Důležité poznámky:**
*   Příznak `--rm` zajišťuje, že kontejner bude po dokončení odstraněn
*   Snímky obrazovky se ukládají do adresáře `./data/test-results/`
*   Skripty se mountují z lokálního filesystému pro živé úpravy
*   `GEMINI_API_KEY` je vyžadován pro AI funkce a musí být nastaven v `.env`