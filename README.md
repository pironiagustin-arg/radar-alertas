# Radar de Alertas

Grupos de acciones con condiciones técnicas, fundamentals y objetivos propios. Rankea por cuántas (y cuáles) se cumplen y avisa cuando aparece una nueva.

## Correr local
```
npm install
npm run dev     # http://localhost:3000
```

## Deploy en Vercel
Subí la carpeta a un repo de GitHub e importalo en Vercel (Framework: Other). `public/` es el front, `api/data.js` la función que trae datos de Yahoo Finance.

## Cómo funciona
- **Datos**: `api/data.js` trae ~2 años de precios diarios + fundamentals (P/E fwd, PEG, EV/EBITDA, D/E, earnings vs estimado, revisiones de EPS, compras de insiders, próximo reporte, EPS trimestral YoY). Cache 10 min.
- **Indicadores y reglas**: `public/engine.js` (EMA50/200, RSI14, MACD 12/26/9, divergencias por pivotes, fuerza relativa vs benchmark). Para agregar una regla, sumala a `RULES`.
- **Score** = Σ peso de positivas cumplidas − Σ peso de negativas activas. Datos faltantes (n/d) no suman ni restan.
- **Objetivos**: por ticker cargás número de venta y promedio por métrica (precio, P/E, PEG, EV/EBITDA, RSI). Tocar la venta dispara alerta negativa; estar X% debajo del promedio suma.
- **Alertas**: cuando una condición pasa de "no" a "sí" entre actualizaciones → feed + notificación del navegador (🔔). Refresca cada 15 min con la pestaña abierta.
- **Config**: se guarda en el navegador (localStorage). Exportá/importá JSON desde Ajustes.
