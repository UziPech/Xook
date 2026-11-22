import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryGraphSnapshot,
  estimateTokensFromText,
  scoreFactRelevance,
  selectStartupMemoryPayload,
} from "./memoryGraph.ts";
import type { UserMemoryFact } from "./userDataStore.ts";

const SAMPLE_FACTS: UserMemoryFact[] = [
  {
    id: "f_identity_name",
    key: "nombre_usuario",
    category: "identity",
    value: "Se llama Uziel Castillo y dirige el desarrollo de Xook en Guadalajara",
    scope: "global",
    sourceWindow: "main",
    pinned: true,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-21T10:00:00Z",
  },
  {
    id: "f_pref_lang",
    key: "estilo_respuesta",
    category: "preference",
    value: "Prefiere respuestas concisas en español directo sin rodeos",
    scope: "global",
    sourceWindow: "main",
    pinned: true,
    createdAt: "2026-11-20T10:05:00Z",
    updatedAt: "2026-11-21T09:30:00Z",
  },
  {
    id: "f_work_shopify",
    key: "integracion_shopify",
    category: "work",
    value: "Administra inventario omnicanal de Shopify y sincroniza catálogos mayoristas",
    scope: "workspace",
    sourceWindow: "main",
    pinned: false,
    createdAt: "2026-11-20T11:00:00Z",
    updatedAt: "2026-11-21T08:00:00Z",
  },
  {
    id: "f_project_tauri",
    key: "arquitectura_tauri",
    category: "project",
    value: "Construye aplicación desktop con Tauri, React y sidecar Python local",
    scope: "workspace",
    sourceWindow: "quick",
    pinned: false,
    createdAt: "2026-11-20T12:00:00Z",
    updatedAt: "2026-11-21T07:00:00Z",
  },
  {
    id: "f_contact_proveedor",
    key: "proveedor_logistica",
    category: "contact",
    value: "Contacto de logística urgente: Mariana López encargada de embarques nacionales",
    scope: "global",
    sourceWindow: "main",
    pinned: false,
    createdAt: "2026-11-20T13:00:00Z",
    updatedAt: "2026-11-21T06:00:00Z",
  },
  {
    id: "f_routine_corte",
    key: "corte_caja_viernes",
    category: "routine",
    value: "Todos los viernes a las 18:00 revisa el corte semanal de ventas y métricas",
    scope: "global",
    sourceWindow: "main",
    pinned: false,
    createdAt: "2026-11-20T14:00:00Z",
    updatedAt: "2026-11-21T05:00:00Z",
  },
];

test("estimateTokensFromText devuelve 0 en vacío y redondea hacia arriba con factor 3.8", () => {
  assert.equal(estimateTokensFromText(""), 0);
  assert.equal(estimateTokensFromText("   "), 0);
  assert.equal(estimateTokensFromText("abc"), 1);
  assert.equal(estimateTokensFromText("12345678"), Math.ceil(8 / 3.8));
});

test("scoreFactRelevance ignora stopwords/tildes y puntúa coincidencias en key, value y categoría", () => {
  const fact = SAMPLE_FACTS[2]; // integracion_shopify / work
  assert.equal(scoreFactRelevance(fact, ""), 0);
  assert.equal(scoreFactRelevance(fact, "hola como estas por favor"), 0);
  assert.equal(scoreFactRelevance(fact, "de el la y en"), 0);

  // Coincidencia directa en key y value (con tildes y mayúsculas)
  const scoreDirect = scoreFactRelevance(fact, "¿Cómo va la INTEGRACIÓN de Catálogos en Shopify?");
  assert.ok(scoreDirect >= 8, `Se esperaba score alto, se obtuvo ${scoreDirect}`);

  // Coincidencia por sinónimo de categoría ("trabajo" -> work)
  const scoreCat = scoreFactRelevance(fact, "mi trabajo actual");
  assert.ok(scoreCat > 0);
});

test("selectStartupMemoryPayload separa L0, deja L1 en 0 tokens sin consulta y resume L2 en 1 línea", () => {
  const secretFact: UserMemoryFact = {
    id: "f_secret",
    key: "api_key",
    category: "identity",
    value: "Mi clave privada es sk-or-v1-abcdef1234567890secret",
    scope: "global",
    sourceWindow: "main",
    pinned: true,
    createdAt: "2026-11-21T10:00:00Z",
    updatedAt: "2026-11-21T10:00:00Z",
  };

  const selection = selectStartupMemoryPayload([...SAMPLE_FACTS, secretFact], {
    query: "",
  });

  // Filtra el secreto y conserva solo los 6 hechos válidos
  assert.equal(selection.stats.totalFacts, 6);
  assert.equal(selection.l0Facts.length, 2);
  assert.equal(selection.l1Facts.length, 0);
  assert.equal(selection.l2Facts.length, 4);
  assert.equal(selection.stats.l1Tokens, 0);
  assert.ok(selection.l2IndexLine.includes("Índice memoria L2 (4 hechos"));
  assert.ok(selection.promptBlock.includes(selection.l2IndexLine));
  assert.ok(!selection.promptBlock.includes("sk-or-v1-"));

  // Ahorro real de tokens frente a inyección ingenua
  assert.ok(selection.stats.optimizedTokensEstimate < selection.stats.naiveTokensEstimate);
  assert.ok(selection.stats.savedTokensEstimate > 0);
  assert.ok(selection.stats.savedPct > 0);
});

test("selectStartupMemoryPayload promueve hechos relevantes de L2 a L1 cuando la consulta coincide", () => {
  const selection = selectStartupMemoryPayload(SAMPLE_FACTS, {
    query: "Necesito revisar el inventario de Shopify y embarques con Mariana",
  });

  assert.equal(selection.l0Facts.length, 2);
  assert.equal(selection.l1Facts.length, 2);
  assert.ok(selection.l1Facts.some((f) => f.id === "f_work_shopify"));
  assert.ok(selection.l1Facts.some((f) => f.id === "f_contact_proveedor"));
  assert.equal(selection.l2Facts.length, 2);
  assert.ok(selection.stats.l1Tokens > 0);
});

test("selectStartupMemoryPayload desborda excedentes de L0 hacia L1/L2 cuando l0MaxChars es pequeño", () => {
  const selection = selectStartupMemoryPayload(SAMPLE_FACTS, {
    query: "",
    l0MaxChars: 95,
  });

  assert.equal(selection.l0Facts.length, 1);
  assert.equal(selection.l2Facts.length, 5);
});

test("buildMemoryGraphSnapshot genera layout orgánico tipo Obsidian relajado por fuerzas, curveSeed determinista y enlaces semánticos", () => {
  const snapshot = buildMemoryGraphSnapshot({
    agentName: "Xox",
    userProfile: {
      name: "Uziel",
      role: "Fundador",
      storeName: "Xook HQ",
    },
    userFacts: SAMPLE_FACTS,
    workspaceFacts: [
      "- El inventario de Shopify se sincroniza cada 15 minutos con el almacén central",
      "- Los viernes se genera reporte ejecutivo de ventas",
    ],
    patterns: [
      {
        id: "p1",
        description: "Consulta métricas de ventas e inventario al abrir la jornada",
        confidence: 0.88,
      },
    ],
    preferences: {
      donts: ["Nunca inventar cifras de inventario"],
      likes: ["Tablas compactas con totales"],
    },
    activeQuery: "sincronizar inventario de Shopify",
  });

  const hub = snapshot.nodes.find((n) => n.id === "hub_core");
  assert.ok(hub);
  assert.equal(hub.x, 400);
  assert.equal(hub.y, 260);
  assert.equal(hub.radius, 28);

  const categoryNodes = snapshot.nodes.filter((n) => n.kind === "category");
  assert.ok(categoryNodes.length >= 6);
  assert.equal(categoryNodes.length, snapshot.categories.length);

  // Los nodos de categoría tienen radios orgánicos variados (no un círculo rígido idéntico)
  const categoryDistances = categoryNodes.map((catNode) =>
    Math.hypot(catNode.x - 400, catNode.y - 260)
  );
  for (const dist of categoryDistances) {
    assert.ok(dist >= 92 && dist <= 185, `Distancia de categoría fuera de rango orgánico: ${dist}`);
  }
  const minCatDist = Math.min(...categoryDistances);
  const maxCatDist = Math.max(...categoryDistances);
  assert.ok(
    maxCatDist - minCatDist >= 12,
    `Las categorías deben tener radios variados estilo Obsidian (rango observado: ${(maxCatDist - minCatDist).toFixed(1)}px)`
  );

  // Los nodos hoja se distribuyen orgánicamente alrededor de sus categorías con radios variados
  const leafNodes = snapshot.nodes.filter((n) => n.kind !== "hub" && n.kind !== "category");
  assert.equal(leafNodes.length, snapshot.stats.totalFacts);
  const leafDistances = leafNodes.map((leaf) => Math.hypot(leaf.x - 400, leaf.y - 260));
  for (const dist of leafDistances) {
    assert.ok(dist >= 145 && dist <= 340, `Distancia de hoja fuera de rango orgánico: ${dist}`);
  }
  assert.ok(
    Math.max(...leafDistances) - Math.min(...leafDistances) >= 18,
    "Las hojas deben presentar variación radial orgánica"
  );

  // Separación mínima entre cualquier par de nodos para evitar colisiones de etiquetas
  for (let i = 0; i < snapshot.nodes.length; i += 1) {
    for (let j = i + 1; j < snapshot.nodes.length; j += 1) {
      const dist = Math.hypot(
        snapshot.nodes[i].x - snapshot.nodes[j].x,
        snapshot.nodes[i].y - snapshot.nodes[j].y
      );
      assert.ok(
        dist >= 48,
        `Colisión entre nodos ${snapshot.nodes[i].id} y ${snapshot.nodes[j].id}: ${dist.toFixed(1)}px`
      );
    }
  }

  // Enlaces jerárquicos y enlaces semánticos por palabra clave compartida ("inventario" / "ventas")
  const hierarchyEdges = snapshot.edges.filter((e) => e.kind === "hierarchy");
  const semanticEdges = snapshot.edges.filter((e) => e.kind === "semantic");
  assert.equal(hierarchyEdges.length, categoryNodes.length + leafNodes.length);
  assert.ok(semanticEdges.length >= 2, "Debe detectar enlaces semánticos entre nodos que comparten keywords");
  assert.ok(semanticEdges.some((e) => e.label === "inventario" || e.label === "shopify" || e.label === "ventas"));

  // Todas las aristas incluyen curveSeed determinista no nulo en [-1, 1] con signos variados
  let positiveSeeds = 0;
  let negativeSeeds = 0;
  for (const edge of snapshot.edges) {
    assert.equal(typeof edge.curveSeed, "number");
    const seed = edge.curveSeed ?? 0;
    assert.ok(seed >= -1 && seed <= 1 && Math.abs(seed) >= 0.25, `curveSeed inválido: ${seed}`);
    if (seed > 0) positiveSeeds += 1;
    if (seed < 0) negativeSeeds += 1;
  }
  assert.ok(positiveSeeds > 0 && negativeSeeds > 0, "curveSeed debe alternar signos + y -");

  // Determinismo: una segunda ejecución produce exactamente las mismas coordenadas y curveSeeds
  const snapshotAgain = buildMemoryGraphSnapshot({
    agentName: "Xox",
    userProfile: {
      name: "Uziel",
      role: "Fundador",
      storeName: "Xook HQ",
    },
    userFacts: SAMPLE_FACTS,
    workspaceFacts: [
      "- El inventario de Shopify se sincroniza cada 15 minutos con el almacén central",
      "- Los viernes se genera reporte ejecutivo de ventas",
    ],
    patterns: [
      {
        id: "p1",
        description: "Consulta métricas de ventas e inventario al abrir la jornada",
        confidence: 0.88,
      },
    ],
    preferences: {
      donts: ["Nunca inventar cifras de inventario"],
      likes: ["Tablas compactas con totales"],
    },
    activeQuery: "sincronizar inventario de Shopify",
  });
  assert.deepEqual(snapshot.nodes, snapshotAgain.nodes);
  assert.deepEqual(snapshot.edges, snapshotAgain.edges);

  // Con activeQuery="sincronizar inventario de Shopify", los nodos relevantes pasan a L1_contextual
  assert.ok(snapshot.stats.l1Count >= 2);
});

test("buildMemoryGraphSnapshot filtra boilerplate, limpia timestamps/tags y adjunta metadatos editables", () => {
  const rawTaggedLine =
    "[2026-11-18 11:04] (negocio) [key:xook_core] Mi proyecto principal es Xook";
  const rawBulletTaggedLine =
    "- [2026-11-19 09:30] [operacion] Corte diario a las 19:00 horas en sucursal centro";

  const snapshot = buildMemoryGraphSnapshot({
    userFacts: [SAMPLE_FACTS[0]],
    workspaceFacts: [
      "Este archivo guarda hechos reales y acuerdos confirmados del negocio.",
      "este archivo contiene instrucciones generales.",
      "Define aquí políticas de compras y autorizaciones.",
      "Aquí se registran los acuerdos del equipo.",
      "AQUI puedes escribir notas iniciales.",
      rawTaggedLine,
      rawBulletTaggedLine,
    ],
    preferences: {
      donts: ["", "Evitar: Nunca inventar cifras de ventas"],
      likes: ["Gustos: Respuestas directas con tablas limpias"],
      workflows: ["Flujo: Validar archivos reales antes de responder"],
    },
    patterns: [
      {
        id: "pat_morning",
        description: "Revisa métricas de pedidos al comenzar el día",
        confidence: 0.91,
      },
    ],
  });

  // Boilerplate lines deben quedar fuera; solo 2 workspace facts reales permanecen
  const wfNodes = snapshot.nodes.filter((n) => n.kind === "workspace_fact");
  assert.equal(wfNodes.length, 2);

  const firstWf = wfNodes[0];
  assert.equal(firstWf.sourceKind, "workspace_fact");
  assert.equal(firstWf.sourceIndex, 5); // Índice real en input.workspaceFacts tras filtrar 5 boilerplate
  assert.equal(firstWf.rawText, rawTaggedLine);
  assert.equal(firstWf.detail, "Mi proyecto principal es Xook");
  assert.equal(firstWf.updatedAt, "2026-11-18 11:04");
  assert.equal(firstWf.factKey, "xook_core");
  assert.ok(firstWf.label.length <= 24, `Label demasiado largo: "${firstWf.label}"`);
  assert.ok(!firstWf.label.includes("2026"));
  assert.ok(!firstWf.label.includes("[key:"));

  const secondWf = wfNodes[1];
  assert.equal(secondWf.sourceKind, "workspace_fact");
  assert.equal(secondWf.sourceIndex, 6);
  assert.equal(secondWf.rawText, rawBulletTaggedLine);
  assert.equal(secondWf.detail, "Corte diario a las 19:00 horas en sucursal centro");
  assert.equal(secondWf.updatedAt, "2026-11-19 09:30");
  assert.ok(secondWf.label.length <= 24);

  // User fact metadata
  const userFactNode = snapshot.nodes.find((n) => n.kind === "fact");
  assert.ok(userFactNode);
  assert.equal(userFactNode.sourceKind, "user_fact");
  assert.equal(userFactNode.rawText, SAMPLE_FACTS[0].value);
  assert.ok(userFactNode.label.length <= 24);

  // Preference metadata y eliminación de prefijos redundantes ("Gustos:", "Flujo:", "Evitar:")
  const prefNodes = snapshot.nodes.filter((n) => n.kind === "preference");
  assert.equal(prefNodes.length, 3);

  const dontNode = prefNodes.find((n) => n.preferenceBucket === "donts");
  assert.ok(dontNode);
  assert.equal(dontNode.sourceKind, "preference");
  assert.equal(dontNode.sourceIndex, 1); // índice 0 era ""
  assert.equal(dontNode.rawText, "Evitar: Nunca inventar cifras de ventas");
  assert.equal(dontNode.detail, "Nunca inventar cifras de ventas");
  assert.ok(!dontNode.label.toLowerCase().startsWith("evitar:"));
  assert.ok(dontNode.label.length <= 24);

  const likeNode = prefNodes.find((n) => n.preferenceBucket === "likes");
  assert.ok(likeNode);
  assert.equal(likeNode.sourceKind, "preference");
  assert.equal(likeNode.sourceIndex, 0);
  assert.equal(likeNode.rawText, "Gustos: Respuestas directas con tablas limpias");
  assert.equal(likeNode.detail, "Respuestas directas con tablas limpias");
  assert.ok(!likeNode.label.toLowerCase().startsWith("gusto"));
  assert.ok(likeNode.label.length <= 24);

  const flowNode = prefNodes.find((n) => n.preferenceBucket === "workflows");
  assert.ok(flowNode);
  assert.equal(flowNode.sourceKind, "preference");
  assert.equal(flowNode.sourceIndex, 0);
  assert.equal(flowNode.rawText, "Flujo: Validar archivos reales antes de responder");
  assert.equal(flowNode.detail, "Validar archivos reales antes de responder");
  assert.ok(!flowNode.label.toLowerCase().startsWith("flujo"));
  assert.ok(flowNode.label.length <= 24);

  // Pattern metadata
  const patternNode = snapshot.nodes.find((n) => n.kind === "pattern");
  assert.ok(patternNode);
  assert.equal(patternNode.sourceKind, "pattern");
  assert.equal(patternNode.sourceIndex, 0);
  assert.equal(patternNode.rawText, "Revisa métricas de pedidos al comenzar el día");
  assert.ok(patternNode.label.length <= 24);
});

test("buildMemoryGraphSnapshot evita enlaces por números/stopwords y limita enlaces semánticos (<=2/hoja, <=14 total)", () => {
  // Caso A: hechos que solo comparten años, timestamps y stopwords genéricas -> 0 enlaces semánticos
  const noisySnapshot = buildMemoryGraphSnapshot({
    workspaceFacts: [
      "[2026-11-18 11:04] (negocio) Siempre usar datos del usuario en este proyecto para trabajo",
      "[2026-11-18 11:05] (negocio) Nunca poner otros hechos del espacio sin regla para datos",
      "[2026-11-18 11:06] (negocio) Puede hacer cada archivo del proyecto muy bien todo el tiempo",
    ],
  });
  const noisySemantic = noisySnapshot.edges.filter((e) => e.kind === "semantic");
  assert.equal(
    noisySemantic.length,
    0,
    `No debe crear enlaces por números ni stopwords; creó: ${noisySemantic.map((e) => e.label).join(", ")}`
  );

  // Caso B: 18 nodos compartiendo una keyword fuerte -> máx 2 por hoja y máx 14 totales
  const denseWorkspaceFacts = Array.from(
    { length: 12 },
    (_, i) =>
      `[2026-11-18 10:${String(i).padStart(2, "0")}] (negocio) Sincronización logística almacén Guadalajara lote alpha${i}`
  );
  const denseUserFacts: UserMemoryFact[] = Array.from({ length: 6 }, (_, i) => ({
    id: `dense_${i}`,
    key: `logistica_${i}`,
    category: i % 2 === 0 ? "work" : "project",
    value: `Control de almacén Guadalajara y logística prioritaria módulo beta${i}`,
    scope: "global",
    sourceWindow: "main",
    pinned: false,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-21T10:00:00Z",
  }));

  const denseSnapshot = buildMemoryGraphSnapshot({
    userFacts: denseUserFacts,
    workspaceFacts: denseWorkspaceFacts,
  });

  const denseSemantic = denseSnapshot.edges.filter((e) => e.kind === "semantic");
  assert.ok(
    denseSemantic.length > 0 && denseSemantic.length <= 14,
    `Total de enlaces semánticos fuera de rango (1..14): ${denseSemantic.length}`
  );

  const degree = new Map<string, number>();
  for (const edge of denseSemantic) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  for (const [nodeId, count] of degree.entries()) {
    assert.ok(
      count <= 2,
      `El nodo ${nodeId} excedió el máximo de 2 enlaces semánticos (tuvo ${count})`
    );
  }
});

test("buildMemoryGraphSnapshot asigna arcos proporcionales y separación cómoda sin colisiones a clústeres densos", () => {
  const snapshot = buildMemoryGraphSnapshot({
    userFacts: [SAMPLE_FACTS[0], SAMPLE_FACTS[2]],
    workspaceFacts: Array.from(
      { length: 8 },
      (_, i) => `[2026-11-18 11:0${i}] (negocio) Acuerdo comercial sucursal número ${i + 1}`
    ),
  });

  const wfLeaves = snapshot.nodes.filter((n) => n.kind === "workspace_fact");
  assert.equal(wfLeaves.length, 8);

  // Todos se mantienen en una banda orgánica alrededor del centro (150..320)
  for (const leaf of wfLeaves) {
    const dist = Math.hypot(leaf.x - 400, leaf.y - 260);
    assert.ok(dist >= 150 && dist <= 325, `Distancia fuera de rango orgánico: ${dist}`);
  }

  // Verificar que los 8 nodos de workspace cubren un arco amplio (> 95 grados)
  // y que ninguna pareja de nodos colapsa encima de otra (>= 48px euclidiano)
  const angles = wfLeaves
    .map((n) => Math.atan2(n.y - 260, n.x - 400))
    .sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < angles.length; i += 1) {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
    maxGap = Math.max(maxGap, next - angles[i]);
  }
  const coveredArc = 2 * Math.PI - maxGap;
  assert.ok(
    coveredArc > (95 * Math.PI) / 180,
    `El clúster de 8 hechos debe distribuirse en un arco amplio; cubrió ${((coveredArc * 180) / Math.PI).toFixed(1)}°`
  );

  for (let i = 0; i < snapshot.nodes.length; i += 1) {
    for (let j = i + 1; j < snapshot.nodes.length; j += 1) {
      const dist = Math.hypot(
        snapshot.nodes[i].x - snapshot.nodes[j].x,
        snapshot.nodes[i].y - snapshot.nodes[j].y
      );
      assert.ok(
        dist >= 48,
        `Dos nodos quedaron demasiado juntos (${snapshot.nodes[i].id} vs ${snapshot.nodes[j].id}: ${dist.toFixed(1)}px)`
      );
    }
  }
});
