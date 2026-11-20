# KlassikernN – Shopify Rip & Ship-kø for Dokploy

Ferdig Bun-applikasjon (ingen avhengigheter) med Dockerfile, OBS Browser Source og passordbeskyttet køkontroll. **Krever tilkobling og konfigurering før produksjonsbruk.** Ingen direkte tilgang til Shopify Admin API er nødvendig for å motta webhook.

## Slik deployer du i Dokploy (Dockerfile + Bun)

1. Legg repoet i et **privat GitHub/Git-repository**. Ikke legg inn hemmeligheter i repoet. `Dockerfile` må ligge i repository-roten.
2. Opprett et prosjekt i Dokploy → **Application** → velg Git/GitHub som kilde og repository/branch. Under **Build Type** velger du **Dockerfile** (Docker File: `Dockerfile`, Docker Context Path: `.`). Bildet bygges fra `oven/bun` og starter med `bun run server.js`.
3. Legg inn alle variablene fra `.env.example` under Application → **Environment** i Dokploy. Bruk nye, lange tilfeldige hemmeligheter, og sett i tillegg `COOKIE_SECURE=true`. `SHOPIFY_CLIENT_SECRET` er signeringsnøkkelen for den aktuelle webhooken: for webhooks opprettet i Shopify Admin brukes butikkens webhook-signeringsecret, mens app-registrerte webhooks normalt bruker appens client secret. Sjekk Shopify hvor webhooken er opprettet; de er ikke nødvendigvis samme verdi.
4. Under Application → **Advanced → Volumes/Mounts**: legg til et **Volume Mount** med navn f.eks. `klassikernn_queue_data` og Mount Path **`/data`**. Uten dette mistes køen ved hver redeploy.
5. Deploy. Under Application → **Domains**: legg til `queue.klassikernn.no`, container-port **3000**, HTTPS med Let's Encrypt. DNS for `queue.klassikernn.no` må peke til serveren. Ikke publiser port 3000 direkte.
6. Kontroller at `https://queue.klassikernn.no/health` returnerer `{"ok":true}`. Åpne `/admin` og logg inn med `ADMIN_PASSWORD`. Test en manuelt opprettet bestilling.
7. I OBS → Sources → Browser Source: URL `https://queue.klassikernn.no/overlay?key=DIN_OVERLAY_KEY`, bredde 1920, høyde 1080. Plasser køen til høyre. **Ikke vis URL med nøkkel på stream.**
8. Shopify Admin → Settings → Notifications → Webhooks. Opprett **tre** webhooks med format **JSON** og en støttet API-versjon:
   - **Order payment** (`orders/paid`): `https://queue.klassikernn.no/webhooks/orders-paid`
   - **Order cancellation** (`orders/cancelled`): `https://queue.klassikernn.no/webhooks/orders-cancelled`
   - **Refund create** (`refunds/create`): `https://queue.klassikernn.no/webhooks/refunds-create`

   Sjekk at webhookenes signeringsnøkkel er den du konfigurerte. Utfør en betalt testordre med ulike verdier for `Åpnes på stream` og `Levering`, og test deretter kansellering og refusjon med egne testordre.

## Hvordan køen fungerer

- Alle betalte ordre havner i én kø, uansett SKU. Én ordre = én køoppføring med alle produktene. Dubletter med samme Shopify-order-ID legges ikke inn flere ganger.
- Hver ordrelinje leser Shopify-egenskapene **`Åpnes på stream`** (eller eldre **`Åpnes på live`**) (`Ja`/`Nei`) og **`Levering`**. Produktene merkes `ÅPNES LIVE`, `UÅPNET` eller `VALG UKJENT` (feltet manglet i webhooken – vi antar **ikke** at varen skal åpnes). `Levering` vises kun i admin.
- **Kansellering** merker ikke-fullførte ordre som kansellert og skjuler dem fra overlay. En kansellering som kommer før «betalt» huskes, så en senere betalt-webhook ikke reaktiverer ordren.
- **Refusjon** merker ikke-fullførte ordre `SJEKK REFUSJON` i admin (en refusjon kan være delvis). Gå gjennom ordren i Shopify og velg selv om den skal fullføres eller settes tilbake i kø.
- OBS viser **kun** offentlig bestillingsreferanse, produktlinjer og livevalg, aldri e-post, telefon eller leveringsadresse. Endre visningsnavn manuelt i admin når det er avklart med kunden.
- Admin lar deg opprette testordre, flytte opp/ned, markere `Åpnes nå`, `Fullført`, endre visningsnavn. «Fullført» gjelder bare køen; den oppfyller ikke ordren i Shopify. OBS oppdateres omtrent hvert tredje sekund.
- Varig data ligger i `/data/queue-data.json`, på volumet du monterte på `/data` i Dokploy. Ta backup av volumet jevnlig og **ikke** slett volumet ved redeploy.

## Drift og begrensninger

- Én applikasjonsinstans / én replika. JSON-fil er ikke egnet til flere skrivende instanser.
- Admin er passordbeskyttet. Begrens admin-tilgang med VPN/tilgangsregler i tillegg hvis mulig. Ikke bruk en gjenbrukt butikkpassord.
- Shopify-webhooken verifiseres via HMAC mot **rå forespørselsbody**, butikkdomene og topic. Ordreduplikater avvises. Ikke legg Shopify-hemmeligheter i Git.
- Kansellering/refusjon endrer aldri en allerede «Fullført»-ordre. Refusjon før «betalt» blir ikke tilbakeført i køstatus. Missede webhooks etter servernedetid hentes ikke automatisk. For produksjon med større trafikk bør vi legge til Shopify Admin API-avstemming.
- Store mengder bestillinger krever database, backup og overvåkning. Test ordreflyt før du begynner å selge.
- Browser Source-nøkkelen gir kun visningstilgang og kan roteres i Dokploy. Unngå å vise OBS-kildeegenskaper mens du streamer.

## Relevante dokumenter

- Dokploy applications: https://docs.dokploy.com/docs/core/applications
- Bun: https://bun.sh/docs
- Shopify webhook: https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks
- Shopify HMAC: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
