// =============================================
// CONFIGURACIÓN SUPABASE
// La SUPABASE_KEY es la clave "anon" (pública).
// Es seguro incluirla aquí SOLO si tienes RLS
// (Row Level Security) correctamente configurado
// en Supabase. NUNCA uses la clave "service_role"
// en el frontend.
// =============================================
const SUPABASE_URL = 'https://twpwrflhkltitynmgmva.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3cHdyZmxoa2x0aXR5bm1nbXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA2MjE1MjAsImV4cCI6MjA3NjE5NzUyMH0.uPE2HXF7dOKmAfwnnIpQ4Zmr156aHaSnOj68_ihxH-A';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// =============================================
// EMAILJS — Formulario de contacto
// =============================================
if (typeof emailjs !== 'undefined') {
  emailjs.init('B1zCNtTvQWGh8738F');
}

// =============================================
// CONSTANTES DE SEGURIDAD / VALIDACIÓN
// =============================================
const SECURITY = {
  // Tipos de reporte permitidos (whitelist)
  TIPOS_VALIDOS: [
    'Alumbrado',
    'Bache',
    'Falta de alcantarilla',
    'Drenaje saturado o mal olor constante',
    'Fuga de agua',
    'Basura acumulada'
  ],
  MAX_NOMBRE_LEN: 100,
  MAX_DESC_LEN: 1000,
  MAX_CORREO_LEN: 200,
  MAX_FOTO_BYTES: 5 * 1024 * 1024, // 5 MB
  TIPOS_IMAGEN_PERMITIDOS: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  // Límite de tiempo entre envíos (ms) — anti-spam básico
  RATE_LIMIT_MS: 30000,
};

// Timestamp del último envío (anti-spam cliente)
let ultimoEnvio = 0;

// =============================================
// ESTADO GLOBAL
// =============================================
const state = {
  map: null,
  layers: {
    colonias: L.geoJSON(null),
    reportes: L.layerGroup(),
    buffers: L.layerGroup(),
    heatmap: L.layerGroup(),
    densidad: L.geoJSON(null)
  },
  baseLayers: {
    osm: null,
    satellite: null,
    current: null
  },
  data: {
    colonias: [],
    reportes: [],
    buffers: []
  },
  filters: {
    tipo: ''
  },
  form: {
    open: false,
    location: null,
    tempMarker: null,
    foto: null,
    fotoFile: null
  },
  responsive: {
    panelOpen: false
  }
};

// Colores por tipo de reporte
const colorPorTipo = {
  'Alumbrado': '#FFD700',
  'Bache': '#8B4513',
  'Falta de alcantarilla': '#FF6347',
  'Drenaje saturado o mal olor constante': '#10b981',
  'Fuga de agua': '#1E90FF',
  'Basura acumulada': '#FF8C00'
};

// =============================================
// INICIALIZACIÓN
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  initializeMap();
  await loadAllData();
  attachEventListeners();
  setupRealtimeUpdates();
  handleResponsive();

  // Cerrar modal de foto con Escape o click en backdrop
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFotoModal();
  });
  document.getElementById('fotoModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'fotoModal') closeFotoModal();
  });
});

// =============================================
// MAPA
// =============================================
function initializeMap() {
  state.map = L.map('map', { zoomControl: false }).setView([22.254, -97.860], 13);

  // Zoom: esquina inferior derecha en mobile, superior izquierda en desktop
  const isMobile = window.innerWidth <= 768;
  L.control.zoom({ position: isMobile ? 'bottomright' : 'topleft' }).addTo(state.map);

  // Capas base
  state.baseLayers.osm = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
    attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors',
    className: 'dark-tiles'
  });

  state.baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '© Esri',
    className: 'satellite-tiles'
  });

  state.baseLayers.osm.addTo(state.map);
  state.baseLayers.current = state.baseLayers.osm;

  // state.layers.colonias.addTo(state.map); // apagada por defecto
  state.layers.reportes.addTo(state.map);

  state.layers.colonias.setStyle({
    color: '#3b82f6',
    weight: 1,
    fillOpacity: 0.08
  });

  state.map.on('click', handleMapClick);
}

// =============================================
// CARGA DE DATOS
// =============================================
async function loadAllData() {
  try {
    await Promise.all([
      loadColonias(),
      loadReportes(),
      loadBuffers()
    ]);
  } catch (error) {
    // No exponer detalles del error al usuario
    showStatus('Error al cargar datos. Intenta recargar la página.', 'error');
  }
}

async function loadColonias() {
  const { data, error } = await supabase.rpc('get_colonias_geojson');
  if (error) return;

  state.data.colonias = data || [];
  state.layers.colonias.clearLayers();

  state.data.colonias.forEach(feature => {
    if (feature.geometry && feature.properties) {
      const geoJsonFeature = {
        type: 'Feature',
        geometry: feature.geometry,
        properties: feature.properties
      };

      state.layers.colonias.addData(geoJsonFeature);

      state.layers.colonias.eachLayer(layer => {
        if (layer.feature.properties.gid === feature.properties.gid) {
          layer.on('click', (e) => handleColoniaClick(e, feature));
          if (feature.properties.nombre) {
            // Escapar el nombre antes de usarlo como tooltip
            layer.bindTooltip(escapeHtml(feature.properties.nombre));
          }
        }
      });
    }
  });
}

async function loadReportes() {
  const { data, error } = await supabase.rpc('get_reportes_geojson');
  if (error) return;

  state.data.reportes = data || [];
  applyFilters();
}

async function loadBuffers() {
  const { data, error } = await supabase.rpc('get_buffers_geojson');
  if (error) return;

  state.data.buffers = data || [];
  applyFilterBuffers();
}

// =============================================
// FILTROS Y VISUALIZACIÓN
// =============================================
function applyFilters() {
  state.layers.reportes.clearLayers();

  state.data.reportes.forEach(feature => {
    const coords = feature.geometry?.coordinates;
    if (!coords) return;

    const props = feature.properties;
    if (state.filters.tipo && props.tipo !== state.filters.tipo) return;

    const latlng = [coords[1], coords[0]];
    const color = getMarkerColor(props.tipo);
    const fechaFormato = formatDate(props.fecha);
    const idUnico = escapeHtml(props.identificador_unico || 'N/A');

    // Escapar todos los datos del servidor antes de insertarlos en el DOM
    const tipoSafe = escapeHtml(props.tipo || '');
    const descSafe = escapeHtml(props.descripcion || '');

    let estadoClass = 'pendiente';
    let estadoLabel = 'Pendiente';
    const estadoNorm = (props.estado || '').toLowerCase().trim();
    if (estadoNorm === 'en proceso') {
      estadoClass = 'en-proceso';
      estadoLabel = 'En Proceso';
    } else if (estadoNorm === 'solucionado') {
      estadoClass = 'solucionado';
      estadoLabel = 'Solucionado';
    }

    const popupContent = `
      <div class="popup-container">
        <div class="popup-header">
          <span class="ico ico-popup" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>
          <div>
            <h3 class="popup-title">${tipoSafe}</h3>
            <span class="popup-badge" style="background: ${color}20; color: ${color};">${tipoSafe}</span>
          </div>
        </div>
        
        <div class="popup-content">
          <div class="popup-section">
            <p class="popup-description">${descSafe}</p>
          </div>

          <div class="popup-section">
            <h4 class="popup-section-title"><span class="ico ico-popup" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span> Información</h4>
            <div class="popup-date-block">
              <div class="popup-date-row">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="popup-date-ico"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span class="popup-date-value">${fechaFormato.fecha}</span>
              </div>
              <div class="popup-date-row">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="popup-date-ico"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span class="popup-date-hora">${fechaFormato.hora}</span>
              </div>
            </div>
          </div>

          <div class="popup-status ${estadoClass}">
            ● ${estadoLabel}
          </div>
        </div>

        <div class="popup-footer">
          <span class="popup-id">ID: ${idUnico}</span>
        </div>
      </div>
    `;

    const marker = L.circleMarker(latlng, {
      radius: 8,
      fillColor: color,
      color: '#000',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).bindPopup(popupContent, {
      className: 'custom-popup',
      maxWidth: 400,
      minWidth: 300
    });

    // Al abrir el popup, consultar si hay foto validada para este reporte
    marker.on('popupopen', () => {
      loadFotoValidada(props.identificador_unico);
    });

    state.layers.reportes.addLayer(marker);
  });

  updateHeatmap();
}

function applyFilterBuffers() {
  state.layers.buffers.clearLayers();

  state.data.buffers.forEach(feature => {
    const coords = feature.geometry?.coordinates;
    if (!coords || !coords[0]) return;

    const props = feature.properties;
    if (state.filters.tipo && props.tipo_reporte !== state.filters.tipo) return;

    const color = getMarkerColor(props.tipo_reporte);

    const polygon = L.polygon(
      coords[0].map(c => [c[1], c[0]]),
      {
        color: color,
        weight: 2,
        opacity: 0.7,
        fillOpacity: 0.15,
        dashArray: '5, 5',
        interactive: false
      }
    );

    state.layers.buffers.addLayer(polygon);
  });
}

function updateHeatmap() {
  state.layers.heatmap.clearLayers();

  if (state.data.reportes.length === 0) return;

  const puntos = [];
  state.data.reportes.forEach(feature => {
    const coords = feature.geometry?.coordinates;
    if (!coords) return;

    const props = feature.properties;
    if (state.filters.tipo && props.tipo !== state.filters.tipo) return;

    puntos.push({ lat: coords[1], lng: coords[0] });
  });

  if (puntos.length === 0) return;

  let clusters = puntos.map(p => ({
    lat: p.lat,
    lng: p.lng,
    count: 1,
    clustered: false
  }));

  const minDistance = 0.004;
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dist = Math.sqrt(
          Math.pow(clusters[i].lat - clusters[j].lat, 2) +
          Math.pow(clusters[i].lng - clusters[j].lng, 2)
        );

        if (dist < minDistance) {
          clusters[i].lat = (clusters[i].lat * clusters[i].count + clusters[j].lat * clusters[j].count) / (clusters[i].count + clusters[j].count);
          clusters[i].lng = (clusters[i].lng * clusters[i].count + clusters[j].lng * clusters[j].count) / (clusters[i].count + clusters[j].count);
          clusters[i].count += clusters[j].count;
          clusters.splice(j, 1);
          merged = true;
          j--;
        }
      }
    }
  }

  const maxCount = Math.max(...clusters.map(c => c.count));

  clusters.forEach(cluster => {
    const intensity = cluster.count / maxCount;
    let color, radius;

    if (intensity < 0.25) {
      color = '#0099ff';
      radius = 12;
    } else if (intensity < 0.5) {
      color = '#00ff00';
      radius = 16;
    } else if (intensity < 0.75) {
      color = '#ffff00';
      radius = 20;
    } else {
      color = '#ff0000';
      radius = 25;
    }

    const circle = L.circleMarker([cluster.lat, cluster.lng], {
      radius: radius,
      fillColor: color,
      color: color,
      weight: 2,
      opacity: 0.5,
      fillOpacity: 0.4
    }).bindPopup(`
      <div class="popup-container">
        <div class="popup-header">
          <span class="ico ico-popup" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg></span>
          <div>
            <h3 class="popup-title">Zona de Concentración</h3>
            <span class="popup-badge" style="background: ${color}20; color: ${color};">Mapa de Calor</span>
          </div>
        </div>
        
        <div class="popup-content">
          <div class="popup-section">
            <div class="popup-info-item">
              <span class="popup-info-label">Reportes agrupados:</span>
              <span class="popup-info-value">${cluster.count}</span>
            </div>
          </div>
        </div>
      </div>
    `, {
      className: 'custom-popup',
      maxWidth: 400,
      minWidth: 280
    });

    state.layers.heatmap.addLayer(circle);
  });
}

// =============================================
// MANEJADORES DE EVENTOS
// =============================================
function attachEventListeners() {
  const btnMapSelect = document.getElementById('btnMapSelect');
  const btnLocationForm = document.getElementById('btnLocationForm');
  
  if (btnMapSelect) btnMapSelect.addEventListener('click', startMapSelection);
  if (btnLocationForm) btnLocationForm.addEventListener('click', handleLocateFromForm);

  // Búsqueda
  const searchInput = document.getElementById('searchCol');
  searchInput.addEventListener('input', (e) => handleSearchInput(e));

  document.getElementById('btnSearch').addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) searchColonia(query);
  });

  // --- Búsqueda de Lugares de Interés ---
  const searchLugar = document.getElementById('searchLugar');
  searchLugar.addEventListener('input', (e) => handleLugarInput(e));
  searchLugar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchLugares(); }
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query) searchColonia(query);
    }
  });

  document.getElementById('btnSearchLugar').addEventListener('click', searchLugares);

  // Tabs
  document.getElementById('tabColonias').addEventListener('click', () => switchSearchTab('colonias'));
  document.getElementById('tabLugares').addEventListener('click', () => switchSearchTab('lugares'));

  // Cerrar sugerencias de lugares al hacer click fuera
  document.addEventListener('click', (e) => {
    const lugarSug = document.getElementById('lugarSuggestions');
    if (e.target !== searchLugar && lugarSug && !lugarSug.contains(e.target)) {
      lugarSug.style.display = 'none';
    }
  });

  // Toggles de capas
  document.getElementById('toggleColonias').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.colonias.addTo(state.map);
      reorderLayers();
    } else {
      state.map.removeLayer(state.layers.colonias);
    }
  });

  document.getElementById('toggleReportes').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.reportes.addTo(state.map);
    } else {
      state.map.removeLayer(state.layers.reportes);
    }
  });

  document.getElementById('toggleBuffers').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.buffers.addTo(state.map);
      reorderLayers();
    } else {
      state.map.removeLayer(state.layers.buffers);
    }
  });

  // (Eliminado el listener duplicado de toggleHeatmap que existía en el original)
  document.getElementById('toggleHeatmap').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.heatmap.addTo(state.map);
    } else {
      state.map.removeLayer(state.layers.heatmap);
    }
  });

  document.getElementById('toggleDensidad').addEventListener('change', async (e) => {
    if (e.target.checked) {
      await loadDensidadMapa();
      state.layers.densidad.addTo(state.map);
    } else {
      state.map.removeLayer(state.layers.densidad);
      if (state._densidadLeyenda) {
        state.map.removeControl(state._densidadLeyenda);
        state._densidadLeyenda = null;
        const el = document.getElementById('densidadLeyenda');
        if (el) el.remove();
      }
    }
  });

  // Filtro por tipo — validar contra whitelist
  document.getElementById('filterTipo').addEventListener('change', (e) => {
    const val = e.target.value;
    state.filters.tipo = SECURITY.TIPOS_VALIDOS.includes(val) ? val : '';
    applyFilters();
    applyFilterBuffers();
  });

  // Cambio de tipo de mapa base
  document.querySelectorAll('input[name="mapBase"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      // Whitelist explícita para evitar valores arbitrarios
      if (val === 'osm' || val === 'satellite') switchMapBase(val);
    });
  });

  // Botones de acción
  document.getElementById('btnAdd').addEventListener('click', openReportForm);
  document.getElementById('btnCancel').addEventListener('click', closeReportForm);
  document.getElementById('btnSubmit').addEventListener('click', submitReport);
  document.getElementById('btnLocatePanel').addEventListener('click', handleLocatePanel);

  // Modales
  // Panel de estadísticas
  document.getElementById('btnStats').addEventListener('click', async () => {
    const panel = document.getElementById('statsPanel');
    if (panel.classList.contains('open')) {
      closeStatsPanel();
    } else {
      panel.classList.add('open');
      // Esperar datos si aún no han cargado
      let intentos = 0;
      while (state.data.reportes.length === 0 && intentos < 10) {
        await new Promise(r => setTimeout(r, 500));
        intentos++;
      }
      loadRankingTipos();
      loadRankingColonias();
      loadDensidadColonias();
    }
  });
  document.getElementById('closeStatsBtn').addEventListener('click', () => closeStatsPanel());

  // Acordeones estadísticas
  document.getElementById('btnAccColonias').addEventListener('click', () => {
    const acc = document.getElementById('accColonias');
    const opening = !acc.classList.contains('open');
    acc.classList.toggle('open');
    if (opening) loadRankingColonias();
  });

  document.getElementById('btnAccTipos').addEventListener('click', () => {
    const acc = document.getElementById('accTipos');
    const opening = !acc.classList.contains('open');
    acc.classList.toggle('open');
    if (opening) loadRankingTipos();
  });

  document.getElementById('btnHelp').addEventListener('click', () => openModal('helpModal'));
  document.getElementById('btnAbout').addEventListener('click', () => openModal('aboutModal'));
  document.getElementById('closeHelpBtn').addEventListener('click', () => closeModal('helpModal'));
  document.getElementById('closeAboutBtn').addEventListener('click', () => closeModal('aboutModal'));
  document.getElementById('closeFormBtn').addEventListener('click', closeReportForm);
  // Términos y Condiciones
  document.getElementById('btnTerminos')?.addEventListener('click', () => openModal('terminosModal'));
  document.getElementById('closeTerminosBtn')?.addEventListener('click', () => closeModal('terminosModal'));
  document.getElementById('closeTerminosFooterBtn')?.addEventListener('click', () => closeModal('terminosModal'));
  document.getElementById('closeTerminosFooterBtn')?.addEventListener('click', () => closeModal('terminosModal'));
  document.getElementById('btnVerTerminos')?.addEventListener('click', () => openModal('terminosModal'));

  // Checkbox términos: habilita/deshabilita botón de envío
  document.getElementById('aceptaTerminos').addEventListener('change', function() {
    document.getElementById('btnSubmit').disabled = !this.checked;
  });

  // Contacto
  document.getElementById('btnContacto')?.addEventListener('click', () => openModal('contactoModal'));
  document.getElementById('closeContactoBtn')?.addEventListener('click', () => closeModal('contactoModal'));
  document.getElementById('btnCancelContacto')?.addEventListener('click', () => closeModal('contactoModal'));

  document.getElementById('btnContactoFromTerminos')?.addEventListener('click', () => {
    closeModal('terminosModal');
    openModal('contactoModal');
  });
  document.querySelectorAll('.btn-contacto-terms').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal('terminosModal');
      openModal('contactoModal');
    });
  });

  document.getElementById('btnEnviarContacto')?.addEventListener('click', async () => {
    const nombre  = document.getElementById('contactNombre').value.trim();
    const asunto  = document.getElementById('contactAsunto').value.trim();
    const correo  = document.getElementById('contactCorreo').value.trim();
    const mensaje = document.getElementById('contactMensaje').value.trim();

    if (!asunto || !mensaje) {
      if (!asunto) document.getElementById('contactAsunto').style.borderColor = '#e53e3e';
      if (!mensaje) document.getElementById('contactMensaje').style.borderColor = '#e53e3e';
      return;
    }

    const btn = document.getElementById('btnEnviarContacto');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
      await emailjs.send('service_55mc40y', 'template_vyb6liv', {
        title:   asunto,
        name:    nombre || 'Anónimo',
        email:   correo || 'sin-respuesta@geoportal',
        message: mensaje
      });
      btn.textContent = '¡Enviado!';
      setTimeout(() => {
        closeModal('contactoModal');
        document.getElementById('contactNombre').value  = '';
        document.getElementById('contactAsunto').value  = '';
        document.getElementById('contactCorreo').value  = '';
        document.getElementById('contactMensaje').value = '';
        document.getElementById('contactAsunto').style.borderColor  = '';
        document.getElementById('contactMensaje').style.borderColor = '';
        btn.disabled = false;
        btn.textContent = 'Enviar';
      }, 1500);
    } catch (err) {
      console.error('EmailJS error:', err);
      btn.disabled = false;
      btn.textContent = 'Enviar';
      showStatus('Error al enviar el mensaje. Inténtalo de nuevo.', 'error');
    }
  });

  document.getElementById('btnInfoBuffers').addEventListener('click', () => openModal('buffersModal'));
  document.getElementById('btnInfoHeatmap').addEventListener('click', () => openModal('heatmapModal'));
  document.getElementById('closeBuffersBtn').addEventListener('click', () => closeModal('buffersModal'));
  document.getElementById('closeHeatmapBtn').addEventListener('click', () => closeModal('heatmapModal'));

  // Panel de control
  document.getElementById('closePanelBtn').addEventListener('click', closePanel);
  document.getElementById('togglePanelBtn').addEventListener('click', togglePanel);

  // Manejo de foto
  document.getElementById('inputFoto').addEventListener('change', handlePhotoUpload);
  document.getElementById('btnRemovePhoto').addEventListener('click', removePhoto);

  // Cerrar sugerencias al hacer click fuera
  document.addEventListener('click', (e) => {
    const suggestionsList = document.getElementById('suggestionsList');
    if (e.target !== searchInput && !suggestionsList.contains(e.target)) {
      suggestionsList.style.display = 'none';
    }
  });
}

function handleSearchInput(e) {
  const query = e.target.value.trim().toLowerCase();
  const suggestionsList = document.getElementById('suggestionsList');

  if (query.length === 0) {
    suggestionsList.style.display = 'none';
    return;
  }

  const filtered = state.data.colonias.filter(f =>
    f.properties.nombre.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    suggestionsList.style.display = 'none';
    return;
  }

  // Usar textContent en lugar de innerHTML para evitar XSS en sugerencias
  suggestionsList.innerHTML = '';
  filtered.forEach(f => {
    const div = document.createElement('div');
    div.textContent = f.properties.nombre;
    div.addEventListener('click', () => {
      document.getElementById('searchCol').value = f.properties.nombre;
      suggestionsList.style.display = 'none';
      searchColonia(f.properties.nombre);
    });
    suggestionsList.appendChild(div);
  });
  suggestionsList.style.display = 'block';
}

// Eliminada la función window.selectSuggestion expuesta globalmente (vector XSS)

async function searchColonia(query) {
  // Sanitizar: solo letras, espacios y caracteres del español
  const sanitizedQuery = query.replace(/[<>"'`;&]/g, '').substring(0, 100);

  const { data, error } = await supabase.rpc('search_colonia', { p_name: sanitizedQuery });
  if (error) {
    showStatus('Error en la búsqueda', 'error');
    return;
  }

  if (!data || data.length === 0) {
    showStatus('Colonia no encontrada', 'error');
    return;
  }

  state.layers.colonias.clearLayers();
  data.forEach(feature => {
    if (feature.geometry && feature.properties) {
      const geoJsonFeature = {
        type: 'Feature',
        geometry: feature.geometry,
        properties: feature.properties
      };
      state.layers.colonias.addData(geoJsonFeature);
    }
  });

  const bounds = state.layers.colonias.getBounds();
  if (bounds.isValid()) {
    state.map.fitBounds(bounds, { padding: [50, 50] });
  }

  if (data.length === 1) {
    const props = data[0].properties;
    const gid = props.gid;
    const layer = state.layers.colonias.getLayers()[0];

    if (layer) {
      const { data: stats } = await supabase.rpc('get_reports_stats_for_colonia', { p_gid: gid });
      const nombreSafe = escapeHtml(props.nombre || 'Sin nombre');

      let statsHTML = '';
      if (stats && stats.length > 0) {
        const stat = stats[0];
        let total = stat.total || 0;
        if (stat.by_tipo && Object.keys(stat.by_tipo).length > 0) {
          total = Object.values(stat.by_tipo).reduce((sum, cnt) => sum + cnt, 0);
          const tiposHTML = Object.entries(stat.by_tipo)
            .map(([tipo, cnt]) => `
              <div class="popup-stat-item">
                <span class="popup-stat-label">${escapeHtml(tipo)}:</span>
                <span class="popup-stat-value">${Number(cnt)}</span>
              </div>`)
            .join('');
          statsHTML = `
            <div class="popup-stats">
              <div class="popup-stat-item" style="font-weight: 700; margin-bottom: 0.8rem;">
                <span style="color: var(--dark);">Total:</span>
                <span class="popup-stat-value">${Number(total)}</span>
              </div>
              ${tiposHTML}
            </div>`;
        } else {
          statsHTML = `
            <div class="popup-stats">
              <div class="popup-stat-item">
                <span style="color: var(--gray);">Sin reportes</span>
              </div>
            </div>`;
        }
      } else {
        statsHTML = `
          <div class="popup-stats">
            <div class="popup-stat-item">
              <span style="color: var(--gray);">Sin reportes</span>
            </div>
          </div>`;
      }

      const popupContent = `
        <div class="popup-container">
          <div class="popup-header">
            <span class="ico ico-popup" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
            <div>
              <h3 class="popup-title">${nombreSafe}</h3>
              <span class="popup-badge" style="background: var(--surface-3); color: var(--dark-light);">Colonia</span>
            </div>
          </div>
          <div class="popup-content">
            <div class="popup-section">
              <h4 class="popup-section-title">Estadísticas de Reportes</h4>
              ${statsHTML}
            </div>
          </div>
        </div>`;

      layer.bindPopup(popupContent, {
        className: 'custom-popup',
        maxWidth: 400,
        minWidth: 300,
        closeButton: true,
        autoClose: false
      });
      layer.openPopup();

      layer.on('popupclose', () => {
        document.getElementById('searchCol').value = '';
        document.getElementById('suggestionsList').style.display = 'none';
        loadColonias();
      });
    }
  }
}

async function handleColoniaClick(e, feature) {
  if (state.form.open) {
    L.DomEvent.stop(e);
    return;
  }

  const gid = feature.properties.gid;
  const { data: stats, error } = await supabase.rpc('get_reports_stats_for_colonia', { p_gid: gid });

  let statsHTML = '';
  
  if (error) {
    statsHTML = '<p style="color: #ef4444;">Error al obtener estadísticas</p>';
  } else if (stats && stats.length > 0) {
    const stat = stats[0];
    let total = stat.total || 0;
    
    if (stat.by_tipo && Object.keys(stat.by_tipo).length > 0) {
      total = Object.values(stat.by_tipo).reduce((sum, cnt) => sum + cnt, 0);
      
      const tiposHTML = Object.entries(stat.by_tipo)
        .map(([tipo, cnt]) => `
          <div class="popup-stat-item">
            <span class="popup-stat-label">${escapeHtml(tipo)}:</span>
            <span class="popup-stat-value">${Number(cnt)}</span>
          </div>
        `)
        .join('');
      
      statsHTML = `
        <div class="popup-stats">
          <div class="popup-stat-item" style="font-weight: 700; margin-bottom: 0.8rem;">
            <span style="color: var(--dark);">Total:</span>
            <span class="popup-stat-value">${Number(total)}</span>
          </div>
          ${tiposHTML}
        </div>
      `;
    } else {
      statsHTML = `
        <div class="popup-stats">
          <div class="popup-stat-item">
            <span style="color: var(--gray);">Sin reportes</span>
          </div>
        </div>
      `;
    }
  } else {
    statsHTML = `
      <div class="popup-stats">
        <div class="popup-stat-item">
          <span style="color: var(--gray);">Sin reportes</span>
        </div>
      </div>
    `;
  }

  const nombreSafe = escapeHtml(feature.properties.nombre || 'Sin nombre');
  const poblacion = feature.properties.poblacion;
  const pobHTML = (poblacion !== undefined && poblacion !== null)
    ? `<div class="popup-stat-item">
         <span class="popup-stat-label">Población:</span>
         <span class="popup-stat-value">${Number(poblacion).toLocaleString('es-MX')} hab.</span>
       </div>`
    : '';

  const popupContent = `
    <div class="popup-container">
      <div class="popup-header">
        <span class="ico ico-popup" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
        <div>
          <h3 class="popup-title">${nombreSafe}</h3>
          <span class="popup-badge" style="background: var(--primary)20; color: var(--primary);">Colonia</span>
        </div>
      </div>
      
      <div class="popup-content">
        ${pobHTML ? `<div class="popup-section">
          <h4 class="popup-section-title">Datos Poblacionales</h4>
          <div class="popup-stats">${pobHTML}</div>
        </div>` : ''}
        <div class="popup-section">
          <h4 class="popup-section-title">Estadísticas de Reportes</h4>
          ${statsHTML}
        </div>
      </div>
    </div>
  `;

  e.target.bindPopup(popupContent, {
    className: 'custom-popup',
    maxWidth: 400,
    minWidth: 300,
    closeButton: true,
    autoClose: false
  }).openPopup();
}


function createLocationMarker(lat, lng) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="loc-marker-wrap"><div class="loc-marker-pulse"></div><div class="loc-marker-dot"></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  return L.marker([lat, lng], { icon });
}

function handleLocateFromForm() {
  if (!navigator.geolocation) {
    showStatus('Geolocalización no disponible', 'error');
    return;
  }

  showStatus('Obteniendo tu ubicación...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      
      state.map.setView([lat, lng], 17);

      if (state.form.tempMarker) {
        state.map.removeLayer(state.form.tempMarker);
      }

      state.form.tempMarker = createLocationMarker(lat, lng).addTo(state.map);

      state.form.location = { lat, lng };
      document.getElementById('locDisplay').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('locDisplay').classList.add('active');
      showStatus('Ubicación obtenida', 'success');
    },
    () => {
      showStatus('No se pudo obtener la ubicación', 'error');
    }
  );
}

function handleLocatePanel() {
  if (!navigator.geolocation) {
    showStatus('Geolocalización no disponible', 'error');
    return;
  }

  showStatus('Obteniendo tu ubicación...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      
      state.map.setView([lat, lng], 17);

      if (state.form.tempMarker) {
        state.map.removeLayer(state.form.tempMarker);
      }

      state.form.tempMarker = createLocationMarker(lat, lng).addTo(state.map);

      showStatus('Ubicación centrada', 'success');
    },
    () => {
      showStatus('No se pudo obtener la ubicación', 'error');
    }
  );
}

function startMapSelection() {
  closeModal('formModal');
  state.form.open = true;
  
  if (state.map.hasLayer(state.layers.colonias)) {
    state.map.removeLayer(state.layers.colonias);
  }
  document.getElementById('toggleColonias').checked = false;
  document.getElementById('map').classList.add('crosshair');
  
  state.form.location = null;
  document.getElementById('locDisplay').classList.remove('active');
  showStatus('Haz click en el mapa para seleccionar ubicación', 'info');
}

function handleMapClick(e) {
  if (!state.form.open) return;
  const { lat, lng } = e.latlng;
  verifyLocationInColonia(lat, lng);
}

async function verifyLocationInColonia(lat, lng) {
  try {
    const { data, error } = await supabase.rpc('st_contains_point', {
      p_lat: lat,
      p_long: lng
    });

    if (error) {
      showStatus('Error al verificar la ubicación', 'error');
      return;
    }

    if (!data || (Array.isArray(data) && data.length === 0)) {
      showStatus('Esta ubicación está fuera del área de cobertura', 'error');
      return;
    }

    state.form.location = { lat, lng };

    if (state.form.tempMarker) {
      state.map.removeLayer(state.form.tempMarker);
    }

    state.form.tempMarker = L.circleMarker([lat, lng], {
      radius: 10,
      fillColor: '#2563eb',
      color: '#ffffff',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(state.map);
    document.getElementById('locDisplay').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('locDisplay').classList.add('active');
    showStatus('Ubicación seleccionada', 'success');
    
    setTimeout(() => {
      state.form.open = false;
      document.getElementById('map').classList.remove('crosshair');
      document.getElementById('toggleColonias').checked = true;
      state.layers.colonias.addTo(state.map);
      openModal('formModal');
    }, 800);
  } catch (err) {
    showStatus('Error procesando ubicación', 'error');
  }
}

function openReportForm() {
  state.form.open = false;
  openModal('formModal');
  state.form.location = null;
  document.getElementById('locDisplay').textContent = 'Selecciona una ubicación';
  document.getElementById('locDisplay').classList.remove('active');
  closePanel();
}

function closeReportForm() {
  state.form.open = false;
  // Resetear checkboxes al cerrar
  const chkTerminos = document.getElementById('aceptaTerminos');
  const chkNewsletter = document.getElementById('aceptaNewsletter');
  if (chkTerminos) chkTerminos.checked = false;
  if (chkNewsletter) chkNewsletter.checked = false;
  const btnSubmit = document.getElementById('btnSubmit');
  if (btnSubmit) btnSubmit.disabled = true;
  closeModal('formModal');
  document.getElementById('map').classList.remove('crosshair');

  if (state.form.tempMarker) {
    state.map.removeLayer(state.form.tempMarker);
    state.form.tempMarker = null;
  }

  state.form.location = null;
  document.getElementById('inputNombre').value = '';
  document.getElementById('inputCorreo').value = '';
  document.getElementById('inputTipo').value = '';
  document.getElementById('inputDesc').value = '';
  document.getElementById('inputFoto').value = '';
  document.getElementById('locDisplay').textContent = 'No establecida';
  document.getElementById('locDisplay').classList.remove('active');
  document.getElementById('photoPreview').style.display = 'none';
  hideStatus();
  
  state.form.foto = null;
  state.form.fotoFile = null;
  document.getElementById('fileName').textContent = 'Selecciona una imagen';
  
  loadColonias();
}

// =============================================
// ENVÍO DE REPORTE — con validaciones de seguridad
// =============================================
async function submitReport() {
  // Verificar aceptación de términos (doble validación servidor)
  if (!document.getElementById('aceptaTerminos').checked) {
    showStatus('Debes aceptar los Términos y Condiciones para continuar', 'error');
    return;
  }

  // Leer consentimiento de newsletter (opcional)
  const aceptaNewsletter = document.getElementById('aceptaNewsletter')?.checked || false;

  // --- Anti-spam: rate limiting cliente ---
  const ahora = Date.now();
  if (ahora - ultimoEnvio < SECURITY.RATE_LIMIT_MS) {
    const segs = Math.ceil((SECURITY.RATE_LIMIT_MS - (ahora - ultimoEnvio)) / 1000);
    showStatus(`Espera ${segs} segundos antes de enviar otro reporte`, 'error');
    return;
  }

  // --- Leer y sanitizar campos ---
  const nombreRaw  = document.getElementById('inputNombre').value.trim();
  const correoRaw  = document.getElementById('inputCorreo').value.trim();
  const tipoRaw    = document.getElementById('inputTipo').value.trim();
  const descRaw    = document.getElementById('inputDesc').value.trim();

  // Sanitizar: remover caracteres peligrosos y aplicar límites de longitud
  const nombre = sanitizeText(nombreRaw).substring(0, SECURITY.MAX_NOMBRE_LEN) || 'Anónimo';
  const desc   = sanitizeText(descRaw).substring(0, SECURITY.MAX_DESC_LEN);
  const correo = sanitizeText(correoRaw).substring(0, SECURITY.MAX_CORREO_LEN) || null;

  // --- Validaciones ---
  if (!state.form.location) {
    showStatus('Selecciona una ubicación', 'error');
    return;
  }

  // Tipo debe estar en la whitelist
  if (!SECURITY.TIPOS_VALIDOS.includes(tipoRaw)) {
    showStatus('Selecciona un tipo de problemática válido', 'error');
    return;
  }

  if (!desc || desc.length < 5) {
    showStatus('La descripción debe tener al menos 5 caracteres', 'error');
    return;
  }

  if (correo && !isValidEmail(correo)) {
    showStatus('El correo electrónico no es válido', 'error');
    return;
  }

  const btnSubmit = document.getElementById('btnSubmit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Enviando...';

  try {
    const { data: reportData, error: reportError } = await supabase.rpc('insert_report', {
      p_nombre: nombre,
      p_tipo: tipoRaw,           // Ya validado contra whitelist
      p_descripcion: desc,
      p_lat: state.form.location.lat,
      p_long: state.form.location.lng,
      p_correo: correo,
      p_acepta_newsletter: aceptaNewsletter
    });


    if (reportError) {
      showStatus('Error al enviar el reporte. Inténtalo de nuevo.', 'error');
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Enviar Reporte';
      return;
    }

    // Registrar timestamp de envío (anti-spam)
    ultimoEnvio = Date.now();

    if (!reportData) {
      showStatus('Reporte enviado correctamente', 'success');
      closeReportForm();
      setTimeout(async () => { await loadAllData(); }, 1000);
      return;
    }

    // Obtener ID del reporte
    let reportId = null;
    if (Array.isArray(reportData) && reportData.length > 0) {
      reportId = reportData[0].id;
    } else if (typeof reportData === 'object' && reportData.id) {
      reportId = reportData.id;
    } else if (typeof reportData === 'number') {
      reportId = reportData;
    }

    // Subir foto si existe (validada previamente en handlePhotoUpload)
    if (state.form.fotoFile && reportId) {
      try {
        const fileExtension = state.form.fotoFile.name.split('.').pop().toLowerCase();
        // Solo extensiones permitidas
        const extPermitidas = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        if (!extPermitidas.includes(fileExtension)) {
          showStatus('Reporte enviado (extensión de foto no permitida)', 'success');
        } else {
          const cleanFileName = `${reportId}_${Date.now()}.${fileExtension}`;
          const blob = new Blob([state.form.fotoFile], { type: state.form.fotoFile.type });
          
          const { error: uploadError } = await supabase.storage
            .from('reporte_fotos')
            .upload(`reportes/${cleanFileName}`, blob, {
              contentType: state.form.fotoFile.type,
              cacheControl: '3600',
              upsert: false
            });

          if (uploadError) {
            showStatus('Reporte enviado (foto no se pudo guardar)', 'success');
          } else {
            const { data: reporteData, error: fetchError } = await supabase
              .from('Reportes')
              .select('identificador_unico')
              .eq('id', reportId)
              .single();
            
            if (!fetchError && reporteData && reporteData.identificador_unico) {
              await supabase
                .from('reporte_fotos')
                .insert([{
                  identificador_unico: reporteData.identificador_unico,
                  storage_path: `reportes/${cleanFileName}`,
                  storage_file_name: cleanFileName,
                  nombre_archivo: sanitizeText(state.form.fotoFile.name).substring(0, 200),
                  tamano_bytes: state.form.fotoFile.size,
                  tipo_archivo: state.form.fotoFile.type
                }]);
            }
            showStatus('¡Reporte y foto enviados correctamente!', 'success');
          }
        }
      } catch {
        showStatus('Reporte enviado correctamente', 'success');
      }
    } else {
      showStatus('¡Reporte enviado correctamente!', 'success');
    }

    closeReportForm();
    setTimeout(async () => { await loadAllData(); }, 1000);

  } catch {
    showStatus('Error procesando el reporte. Inténtalo de nuevo.', 'error');
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Enviar Reporte';
  }
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  
  if (!file) return;

  // Validar tipo MIME contra whitelist
  if (!SECURITY.TIPOS_IMAGEN_PERMITIDOS.includes(file.type)) {
    showStatus('Formato de imagen no permitido. Usa JPG, PNG, GIF o WebP', 'error');
    e.target.value = '';
    state.form.fotoFile = null;
    state.form.foto = null;
    return;
  }

  // Validar tamaño
  if (file.size > SECURITY.MAX_FOTO_BYTES) {
    showStatus('La imagen es muy grande. Máximo 5MB', 'error');
    e.target.value = '';
    state.form.fotoFile = null;
    state.form.foto = null;
    return;
  }

  state.form.fotoFile = file;

  const reader = new FileReader();
  reader.onload = (event) => {
    state.form.foto = event.target.result;
    document.getElementById('previewImg').src = state.form.foto;
    document.getElementById('photoPreview').style.display = 'block';
    // Usar textContent para mostrar el nombre del archivo de forma segura
    document.getElementById('fileName').textContent = file.name;
    showStatus('Imagen seleccionada', 'success');
  };
  reader.onerror = () => {
    showStatus('Error al leer la imagen', 'error');
    e.target.value = '';
    state.form.fotoFile = null;
    state.form.foto = null;
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  state.form.foto = null;
  state.form.fotoFile = null;
  document.getElementById('inputFoto').value = '';
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('fileName').textContent = 'Selecciona una imagen';
  showStatus('Imagen removida', 'info');
}

// =============================================
// MODALES
// =============================================
function openModal(modalId) {
  // Whitelist de IDs de modales permitidos
  const modalesPermitidos = ['formModal', 'helpModal', 'aboutModal', 'buffersModal', 'heatmapModal', 'terminosModal', 'contactoModal'];
  if (!modalesPermitidos.includes(modalId)) return;

  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('show');
  closePanel();
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('show');
}

// =============================================
// PANEL DE CONTROL RESPONSIVE
// =============================================
function togglePanel() {
  const panel = document.getElementById('controlPanel');
  panel.classList.toggle('open');
}

function closePanel() {
  const panel = document.getElementById('controlPanel');
  panel.classList.remove('open');
}

function handleResponsive() {
  const mediaQuery = window.matchMedia('(max-width: 768px)');

  function handleChange(e) {
    if (e.matches) {
      document.getElementById('togglePanelBtn').classList.remove('hidden');
    } else {
      document.getElementById('togglePanelBtn').classList.add('hidden');
      document.getElementById('controlPanel').classList.remove('open');
    }
  }

  mediaQuery.addEventListener('change', handleChange);
  handleChange(mediaQuery);
}

// =============================================
// UTILIDADES
// =============================================
function switchMapBase(baseType) {
  if (state.baseLayers.current) {
    state.map.removeLayer(state.baseLayers.current);
  }

  if (baseType === 'osm') {
    state.baseLayers.osm.addTo(state.map);
    state.baseLayers.current = state.baseLayers.osm;
    showStatus('Mapa Base activado', 'info');
  } else if (baseType === 'satellite') {
    state.baseLayers.satellite.addTo(state.map);
    state.baseLayers.current = state.baseLayers.satellite;
    showStatus('Vista de Satélite activada', 'info');
  }

  reorderLayers();
}

function reorderLayers() {
  if (state.map.hasLayer(state.layers.colonias)) {
    state.map.removeLayer(state.layers.colonias);
    state.map.addLayer(state.layers.colonias);
  }
  if (state.map.hasLayer(state.layers.buffers)) {
    state.map.removeLayer(state.layers.buffers);
    state.map.addLayer(state.layers.buffers);
  }
  if (state.map.hasLayer(state.layers.reportes)) {
    state.map.removeLayer(state.layers.reportes);
    state.map.addLayer(state.layers.reportes);
  }
  if (state.map.hasLayer(state.layers.heatmap)) {
    state.map.removeLayer(state.layers.heatmap);
    state.map.addLayer(state.layers.heatmap);
  }
}

function getMarkerColor(tipo) {
  return colorPorTipo[tipo] || '#808080';
}

function formatDate(fechaISO) {
  const fecha = new Date(fechaISO);
  const tz = 'America/Mexico_City';
  const fechaStr = fecha.toLocaleDateString('es-MX', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: tz
  });
  const horaStr = fecha.toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz
  });
  // Capitalizar primera letra y limpiar puntos de abreviatura
  const fechaCap = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1).replace(/\.(?=[a-z])/g, '. ').trim();
  return { fecha: fechaCap, hora: horaStr };
}

function getStatusHTML(estado) {
  let color = '#6b7280';
  let etiqueta = 'Desconocido';

  if (estado === 'Pendiente' || estado === 'nuevo') {
    color = '#ef4444';
    etiqueta = 'Pendiente';
  } else if (estado === 'En proceso' || estado === 'en proceso') {
    color = '#f59e0b';
    etiqueta = 'En proceso';
  } else if (estado === 'Solucionado' || estado === 'solucionado') {
    color = '#10b981';
    etiqueta = 'Solucionado';
  }

  return `<div style="margin-top: 0.8rem; font-weight: bold; color: ${color};">Estado: ${etiqueta}</div>`;
}

function showStatus(msg, type = 'info') {
  const el = document.getElementById('statusMsg');
  // Usar textContent para evitar XSS en mensajes de estado
  el.textContent = msg;
  el.className = `status-message show ${type}`;

  setTimeout(() => {
    el.classList.remove('show');
  }, 3000);
}

function hideStatus() {
  const el = document.getElementById('statusMsg');
  el.classList.remove('show');
}

// =============================================
// FUNCIONES DE SEGURIDAD
// =============================================

/**
 * Escapa caracteres HTML especiales para prevenir XSS
 * al insertar datos del servidor en innerHTML.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Elimina caracteres peligrosos de texto de entrada libre
 * para sanitizar antes de enviar a la base de datos.
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  // Eliminar etiquetas HTML y caracteres de control
  return str.replace(/<[^>]*>/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Validación básica de formato de correo electrónico.
 */
function isValidEmail(email) {
  // RFC 5322 simplificado
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// =============================================
// ACTUALIZACIONES EN TIEMPO REAL
// =============================================
function setupRealtimeUpdates() {
  supabase
    .channel('public:Reportes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'Reportes' },
      (payload) => {
        const newRow = payload.new;
        state.data.reportes.push({
          geometry: { coordinates: [newRow.long, newRow.lat] },
          properties: newRow
        });
        applyFilters();
        loadBuffers();
        showStatus('Nuevo reporte recibido', 'info');
      }
    )
    .subscribe();
}

// =============================================
// PANEL DE ESTADÍSTICAS
// =============================================
function toggleStatsPanel() {
  const panel = document.getElementById('statsPanel');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    closeStatsPanel();
  } else {
    openStatsPanel();
  }
}

function openStatsPanel() {
  document.getElementById('statsPanel').classList.add('open');
}

function closeStatsPanel() {
  document.getElementById('statsPanel').classList.remove('open');
}

async function loadRankingColonias() {
  const container = document.getElementById('rankingColonias');
  container.innerHTML = '<div class="ranking-loading">Calculando...</div>';

  // Build ranking from existing colonia data + stats RPC
  const colonias = state.data.colonias;
  if (!colonias || colonias.length === 0) {
    container.innerHTML = '<div class="ranking-loading">Sin datos de colonias</div>';
    return;
  }

  // Fetch stats for each colonia in parallel
  const results = await Promise.all(
    colonias.map(async (feature) => {
      const gid  = feature.properties?.gid;
      const nombre = feature.properties?.nombre || 'Sin nombre';
      if (!gid) return { nombre, total: 0 };
      try {
        const { data } = await supabase.rpc('get_reports_stats_for_colonia', { p_gid: gid });
        if (!data || data.length === 0) return { nombre, total: 0 };
        const stat = data[0];
        const total = stat.by_tipo
          ? Object.values(stat.by_tipo).reduce((s, n) => s + Number(n), 0)
          : Number(stat.total || 0);
        return { nombre, total };
      } catch {
        return { nombre, total: 0 };
      }
    })
  );

  // Sort descending, take top 15
  const ranked = results
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  if (ranked.length === 0) {
    container.innerHTML = '<div class="ranking-loading">Sin reportes registrados</div>';
    return;
  }

  const maxTotal = ranked[0].total;

  container.innerHTML = ranked.map((r, i) => {
    const pos = i + 1;
    const posClass = pos === 1 ? 'top1' : pos === 2 ? 'top2' : pos === 3 ? 'top3' : '';
    const barWidth = Math.round((r.total / maxTotal) * 100);
    return `
      <div class="ranking-item">
        <span class="ranking-pos ${posClass}">${pos}</span>
        <div class="ranking-info">
          <div class="ranking-name" title="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre)}</div>
          <div class="ranking-bar-wrap">
            <div class="ranking-bar" style="width:${barWidth}%"></div>
          </div>
        </div>
        <span class="ranking-count">${r.total}</span>
      </div>`;
  }).join('');
}
// =============================================
// CAPA DE DENSIDAD EN MAPA
// =============================================
function getDensidadColor(densidad, maxDensidad) {
  if (densidad === 0 || maxDensidad === 0) return '#e2e8f0';
  const ratio = densidad / maxDensidad;
  if (ratio < 0.2)  return '#bbf7d0'; // verde claro
  if (ratio < 0.4)  return '#86efac'; // verde
  if (ratio < 0.6)  return '#fde68a'; // amarillo
  if (ratio < 0.8)  return '#fb923c'; // naranja
  return '#ef4444';                    // rojo
}

async function loadDensidadMapa() {
  const { data, error } = await supabase.rpc('get_colonias_densidad');
  if (error || !data || data.length === 0) return;

  const maxDensidad = Math.max(...data.map(r => Number(r.densidad) || 0));

  state.layers.densidad.clearLayers();

  data.forEach(row => {
    if (!row.geometry) return;
    const geom = typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry;
    const densidad = Number(row.densidad) || 0;
    const color = getDensidadColor(densidad, maxDensidad);

    const polygon = L.geoJSON(geom, {
      style: {
        color: '#64748b',
        weight: 0.8,
        opacity: 0.5,
        fillColor: color,
        fillOpacity: densidad === 0 ? 0.15 : 0.55
      }
    });

    polygon.on('click', function(e) {
      if (state.form.open) return;
      const popupContent = `
        <div class="popup-container">
          <div class="popup-header">
            <span class="ico ico-popup" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
            <div>
              <h3 class="popup-title">${escapeHtml(row.nombre)}</h3>
              <span class="popup-badge" style="background: rgba(99,102,241,0.12); color: #6366f1;">Densidad</span>
            </div>
          </div>
          <div class="popup-content">
            <div class="popup-section">
              <h4 class="popup-section-title">Análisis de Densidad</h4>
              <div class="popup-stats">
                <div class="popup-stat-item" style="font-weight: 700; margin-bottom: 0.8rem;">
                  <span style="color: var(--dark);">Densidad:</span>
                  <span class="popup-stat-value">${densidad} rep/ha</span>
                </div>
                <div class="popup-stat-item">
                  <span class="popup-stat-label">Total reportes:</span>
                  <span class="popup-stat-value">${row.total_reportes}</span>
                </div>
                <div class="popup-stat-item">
                  <span class="popup-stat-label">Área:</span>
                  <span class="popup-stat-value">${row.area_ha !== undefined ? row.area_ha : "—"} ha</span>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      L.popup({ className: 'custom-popup', maxWidth: 320, minWidth: 260 })
        .setLatLng(e.latlng)
        .setContent(popupContent)
        .openOn(state.map);
    });

    state.layers.densidad.addLayer(polygon);
  });

  // Leyenda si no existe
  if (!document.getElementById('densidadLeyenda')) {
    const leyenda = L.control({ position: 'bottomright' });
    leyenda.onAdd = () => {
      const div = L.DomUtil.create('div', 'densidad-leyenda');
      div.id = 'densidadLeyenda';
      div.innerHTML = `
        <div class="leyenda-title">Densidad (rep/ha)</div>
        <div class="leyenda-item"><span style="background:#bbf7d0"></span> Muy baja</div>
        <div class="leyenda-item"><span style="background:#86efac"></span> Baja</div>
        <div class="leyenda-item"><span style="background:#fde68a"></span> Media</div>
        <div class="leyenda-item"><span style="background:#fb923c"></span> Alta</div>
        <div class="leyenda-item"><span style="background:#ef4444"></span> Muy alta</div>
        <div class="leyenda-item"><span style="background:#e2e8f0"></span> Sin reportes</div>
      `;
      return div;
    };
    leyenda.addTo(state.map);
    state._densidadLeyenda = leyenda;
  }
}
function loadRankingTipos() {
  const container = document.getElementById('rankingTipos');
  if (!container) return;

  const reportes = state.data.reportes;
  if (!reportes || reportes.length === 0) {
    container.innerHTML = '<div class="ranking-loading">Sin reportes registrados</div>';
    return;
  }

  // Agrupar por tipo
  const conteo = {};
  reportes.forEach(f => {
    const tipo = (f.properties && f.properties.tipo) ? f.properties.tipo : 'Sin tipo';
    conteo[tipo] = (conteo[tipo] || 0) + 1;
  });

  const entries = Object.entries(conteo);
  if (entries.length === 0) {
    container.innerHTML = '<div class="ranking-loading">Sin datos de tipo</div>';
    return;
  }

  const total = Object.values(conteo).reduce((s, n) => s + n, 0);
  const ranked = entries.sort((a, b) => b[1] - a[1]);
  const maxCount = ranked[0][1];

  const tipoColors = {
    'Alumbrado':     '#FFD700',
    'Bache':         '#8B4513',
    'Falta de alcantarilla': '#FF6347',
    'Drenaje saturado o mal olor constante': '#10b981',
    'Fuga de agua':  '#1E90FF',
    'Basura acumulada': '#FF8C00',
  };

  container.innerHTML = ranked.map(([tipo, count], i) => {
    const pos = i + 1;
    const posClass = pos === 1 ? 'top1' : pos === 2 ? 'top2' : pos === 3 ? 'top3' : '';
    const barWidth = Math.round((count / maxCount) * 100);
    const pct = Math.round((count / total) * 100);
    const color = tipoColors[tipo] || '#64748b';
    return `
      <div class="ranking-item">
        <span class="ranking-pos ${posClass}">${pos}</span>
        <div class="ranking-info">
          <div class="ranking-name" title="${escapeHtml(tipo)}">${escapeHtml(tipo)}</div>
          <div class="ranking-bar-wrap">
            <div class="ranking-bar" style="width:${barWidth}%; background:${color};"></div>
          </div>
          <div class="ranking-sub">${pct}% del total</div>
        </div>
        <span class="ranking-count">${count}</span>
      </div>`;
  }).join('');
}

// =============================================
// BÚSQUEDA DE TABS (Colonias / Lugares)
// =============================================
function switchSearchTab(tab) {
  document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.search-tab-panel').forEach(p => p.classList.remove('active'));

  document.getElementById(tab === 'colonias' ? 'tabColonias' : 'tabLugares').classList.add('active');
  document.getElementById(tab === 'colonias' ? 'panelColonias' : 'panelLugares').classList.add('active');
}

// =============================================
// BÚSQUEDA DE LUGARES (Nominatim / OSM)
// =============================================

// Estado para el marcador de lugar activo
let lugarMarker = null;
let lugarDebounceTimer = null;

async function handleLugarInput(e) {
  const query = e.target.value.trim();
  const lugarSug = document.getElementById('lugarSuggestions');

  clearTimeout(lugarDebounceTimer);

  if (query.length < 3) {
    lugarSug.style.display = 'none';
    return;
  }

  lugarDebounceTimer = setTimeout(async () => {
    const results = await fetchLugares(query, true);
    renderLugarSuggestions(results);
  }, 400);
}

async function searchLugares() {
  const query = document.getElementById('searchLugar').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('lugarResults');
  const lugarSug = document.getElementById('lugarSuggestions');
  lugarSug.style.display = 'none';
  resultsContainer.innerHTML = '<div class="lugar-loading"><span class="lugar-spinner"></span> Buscando...</div>';

  const results = await fetchLugares(query, false);

  if (!results || results.length === 0) {
    resultsContainer.innerHTML = '<div class="lugar-empty">No se encontraron resultados en Tampico para esa búsqueda.</div>';
    return;
  }

  renderLugarResults(results);
}

async function fetchLugares(query, autocomplete = false) {
  const q = query.replace(/[<>"'`;&]/g, '').substring(0, 100);
  const limit = autocomplete ? 5 : 10;

  // Detectar si parece una dirección (contiene dígitos)
  const esDir = /\d/.test(q);

  // Intento 1: búsqueda con viewbox en Tampico
  const params1 = new URLSearchParams({
    q: q + ', Tampico, Tamaulipas, México',
    format: 'json',
    limit: limit,
    addressdetails: 1,
    countrycodes: 'mx',
    viewbox: '-98.00,22.40,-97.70,22.10',
    bounded: esDir ? 0 : 1,
    'accept-language': 'es'
  });

  try {
    const res1 = await fetch('https://nominatim.openstreetmap.org/search?' + params1, {
      headers: { 'Accept-Language': 'es' }
    });
    if (res1.ok) {
      const data1 = await res1.json();
      if (data1.length > 0) return data1;
    }
  } catch (err) { /* continuar */ }

  // Fallback: sin bounded, solo countrycodes
  const params2 = new URLSearchParams({
    q: q + ', Tampico, Tamaulipas, México',
    format: 'json',
    limit: limit,
    addressdetails: 1,
    countrycodes: 'mx',
    'accept-language': 'es'
  });

  try {
    const res2 = await fetch('https://nominatim.openstreetmap.org/search?' + params2, {
      headers: { 'Accept-Language': 'es' }
    });
    if (res2.ok) return await res2.json();
  } catch (err) { /* nada */ }

  return [];
}

// Extrae nombre principal y subtítulo de un resultado Nominatim
function formatLugarDisplay(r) {
  const parts = r.display_name.split(',').map(s => s.trim());
  const addr = r.address || {};

  // Para direcciones: "Calle Número, Colonia"
  const esDir = r.class === 'highway' || r.type === 'residential' || addr.road;
  if (esDir && addr.road) {
    const num = addr.house_number ? addr.house_number + ' ' : '';
    const name = addr.road + (num ? ' ' + num.trim() : '');
    const sub = addr.neighbourhood || addr.suburb || addr.city_district || addr.city || parts[1] || '';
    return { name, sub };
  }

  // Para lugares: primer fragmento como nombre, segundo como contexto
  const name = parts[0];
  const sub = parts[1] || addr.suburb || addr.city || '';
  return { name, sub };
}

function renderLugarSuggestions(results) {
  const lugarSug = document.getElementById('lugarSuggestions');
  const searchLugar = document.getElementById('searchLugar');

  if (!results || results.length === 0) {
    lugarSug.style.display = 'none';
    return;
  }

  lugarSug.innerHTML = '';
  results.forEach(r => {
    const { name, sub } = formatLugarDisplay(r);
    const div = document.createElement('div');
    // Nombre principal en negrita + subtítulo en gris
    const span1 = document.createElement('span');
    span1.textContent = name;
    span1.style.fontWeight = '500';
    div.appendChild(span1);
    if (sub) {
      const span2 = document.createElement('span');
      span2.textContent = '  ' + sub;
      span2.style.color = 'var(--gray)';
      span2.style.fontSize = '0.75rem';
      div.appendChild(span2);
    }
    div.title = r.display_name;
    div.addEventListener('click', () => {
      searchLugar.value = name;
      lugarSug.style.display = 'none';
      goToLugar(r);
      document.getElementById('lugarResults').innerHTML = '';
    });
    lugarSug.appendChild(div);
  });
  lugarSug.style.display = 'block';
}

function renderLugarResults(results) {
  const container = document.getElementById('lugarResults');

  container.innerHTML = results.map((r, i) => {
    const { name, sub } = formatLugarDisplay(r);
    const { icon, label } = getTipoLugarIcono(r.class, r.type);
    // Usar sub si existe, si no la etiqueta de tipo
    const subtitulo = sub || label;
    return `
      <div class="lugar-item" data-idx="${i}" title="${escapeHtml(r.display_name)}">
        <div class="lugar-item-icon">${icon}</div>
        <div class="lugar-item-info">
          <div class="lugar-item-name">${escapeHtml(name)}</div>
          <div class="lugar-item-tipo">${escapeHtml(subtitulo)}</div>
        </div>
        <button class="lugar-item-btn" onclick="goToLugarByIdx(${i})" title="Ir al lugar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        </button>
      </div>`;
  }).join('');

  window._lugarResults = results;

  container.querySelectorAll('.lugar-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.lugar-item-btn')) return;
      const idx = parseInt(el.dataset.idx);
      goToLugar(window._lugarResults[idx]);
    });
  });
}

window.goToLugarByIdx = function(idx) {
  if (window._lugarResults && window._lugarResults[idx]) {
    goToLugar(window._lugarResults[idx]);
  }
};

function goToLugar(result) {
  const lat = parseFloat(result.lat);
  const lon = parseFloat(result.lon);
  if (isNaN(lat) || isNaN(lon)) return;

  // Quitar marcador anterior
  if (lugarMarker) {
    state.map.removeLayer(lugarMarker);
    lugarMarker = null;
  }

  const { name, sub } = formatLugarDisplay(result);
  const { icon, label } = getTipoLugarIcono(result.class, result.type);
  const addr = result.address || {};

  // Construir líneas de dirección detalladas
  const calleNum = addr.road
    ? (addr.road + (addr.house_number ? ' #' + addr.house_number : ''))
    : null;
  const colonia = addr.neighbourhood || addr.suburb || addr.city_district || '';
  const ciudad  = addr.city || addr.town || addr.village || 'Tampico';
  const cp      = addr.postcode ? 'C.P. ' + addr.postcode : '';

  const addrLines = [calleNum, colonia, ciudad, cp].filter(Boolean);
  const addrHTML = addrLines.length
    ? addrLines.map(l => '<div>' + escapeHtml(l) + '</div>').join('')
    : '<div>' + escapeHtml(result.display_name) + '</div>';

  // Crear marcador personalizado
  const customIcon = L.divIcon({
    className: '',
    html: '<div class="lugar-map-pin"><div class="lugar-map-pin-icon">' + icon + '</div></div>',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -38]
  });

  lugarMarker = L.marker([lat, lon], { icon: customIcon });

  const popupContent =
    '<div class="popup-container">' +
      '<div class="popup-header">' +
        '<span class="ico ico-popup" aria-hidden="true">' + icon + '</span>' +
        '<div>' +
          '<h3 class="popup-title">' + escapeHtml(name) + '</h3>' +
          '<span class="popup-badge" style="background: rgba(74,103,65,0.12); color: var(--accent);">' + escapeHtml(label) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="popup-content">' +
        '<div class="popup-section">' +
          '<div class="popup-info-item" style="align-items:flex-start; gap:0.4rem;">' +
            '<span class="popup-info-label" style="padding-top:1px;">Dirección:</span>' +
            '<span class="popup-info-value" style="font-size:0.78rem; line-height:1.55;">' + addrHTML + '</span>' +
          '</div>' +
          '<div class="popup-info-item" style="margin-top:0.5rem;">' +
            '<span class="popup-info-label">Coords:</span>' +
            '<span class="popup-info-value">' + lat.toFixed(5) + ', ' + lon.toFixed(5) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="popup-footer">' +
        '<span class="popup-id">OpenStreetMap / Nominatim</span>' +
      '</div>' +
    '</div>';

  lugarMarker.bindPopup(popupContent, {
    className: 'custom-popup',
    maxWidth: 360,
    minWidth: 280
  });

  lugarMarker.addTo(state.map);
  state.map.setView([lat, lon], 17, { animate: true });
  lugarMarker.openPopup();

  // Al cerrar el popup, quitar el marcador
  lugarMarker.on('popupclose', () => {
    if (lugarMarker) {
      state.map.removeLayer(lugarMarker);
      lugarMarker = null;
    }
  });
}

function getTipoLugarIcono(cls, type) {
  // Mapeo de categorías OSM a iconos SVG y etiquetas en español
  const map = {
    amenity: {
      hospital:    { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>', label: 'Hospital' },
      clinic:      { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>', label: 'Clínica' },
      pharmacy:    { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 21v-4"/><path d="M5 3h14v10a7 7 0 0 1-14 0V3z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="12" y1="6" x2="12" y2="12"/></svg>', label: 'Farmacia' },
      school:      { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20M4 20V10l8-7 8 7v10"/><polyline points="12 20 12 13"/><path d="M9 13h6"/></svg>', label: 'Escuela' },
      university:  { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20M4 20V10l8-7 8 7v10"/></svg>', label: 'Universidad' },
      bank:        { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="11"/><path d="M12 3L2 10h20L12 3z"/></svg>', label: 'Banco' },
      restaurant:  { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6h5zm0 0v7"/></svg>', label: 'Restaurante' },
      supermarket: { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>', label: 'Supermercado' },
      fuel:        { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22V7l7-4 7 4v15"/><line x1="3" y1="22" x2="21" y2="22"/><line x1="10" y1="22" x2="10" y2="13"/><line x1="14" y1="22" x2="14" y2="13"/><line x1="10" y1="13" x2="14" y2="13"/></svg>', label: 'Gasolinera' },
      police:      { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', label: 'Policía' },
      fire_station:{ icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>', label: 'Bomberos' },
      parking:     { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>', label: 'Estacionamiento' },
      place_of_worship: { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/></svg>', label: 'Iglesia / Templo' },
    },
    leisure: {
      park:        { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8C8 10 5 19.9 3 22h18M9.5 2a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/><path d="M17 8c0-3.3-2.7-6-6-6S5 4.7 5 8c0 2.4 1.4 4.5 3.5 5.6"/></svg>', label: 'Parque' },
      sports_centre: { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>', label: 'Centro Deportivo' },
      stadium:     { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>', label: 'Estadio' },
    },
    tourism: {
      hotel:       { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20V8l-10-6L2 8z"/><rect x="9" y="14" width="6" height="6"/></svg>', label: 'Hotel' },
      museum:      { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>', label: 'Museo' },
      attraction:  { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', label: 'Atracción' },
    },
    shop: {
      mall:        { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>', label: 'Centro Comercial' },
    },
    highway: {
      default:     { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>', label: 'Vía / Calle' }
    }
  };

  const defaultIcono = { icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>', label: 'Lugar' };

  if (cls && map[cls]) {
    if (type && map[cls][type]) return map[cls][type];
    if (map[cls].default) return map[cls].default;
  }
  return defaultIcono;
}

// =============================================
// FOTO VALIDADA EN POPUP
// =============================================
async function loadFotoValidada(identificadorUnico) {
  if (!identificadorUnico) return;

  try {
    const { data, error } = await supabase
      .from('reporte_fotos')
      .select('storage_path, storage_file_name')
      .eq('identificador_unico', identificadorUnico)
      .eq('validado', 1)
      .limit(1)
      .single();

    if (error || !data) return;

    // Generar URL pública de la imagen desde Supabase Storage
    const { data: urlData } = supabase.storage
      .from('reporte_fotos')
      .getPublicUrl(data.storage_path);

    if (!urlData || !urlData.publicUrl) return;

    const publicUrl = urlData.publicUrl;

    // Inyectar el botón en el footer del popup activo
    const footer = document.querySelector('.leaflet-popup .popup-footer');
    if (!footer) return;

    // Evitar duplicados
    if (footer.querySelector('.popup-foto-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'popup-foto-btn';
    btn.title = 'Ver fotografía del reporte';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      Ver foto
    `;
    btn.addEventListener('click', () => openFotoModal(publicUrl));
    footer.appendChild(btn);

  } catch { /* no hay foto, silencioso */ }
}

function openFotoModal(url) {
  // Validar que la URL pertenece al dominio de Supabase esperado
  const dominioPermitido = 'twpwrflhkltitynmgmva.supabase.co';
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(dominioPermitido)) return;
  } catch { return; }

  const modal = document.getElementById('fotoModal');
  const img   = document.getElementById('fotoModalImg');
  if (!modal || !img) return;

  img.src = url;
  modal.classList.add('show');
}

function closeFotoModal() {
  const modal = document.getElementById('fotoModal');
  const img   = document.getElementById('fotoModalImg');
  if (modal) modal.classList.remove('show');
  if (img)   img.src = '';
}
