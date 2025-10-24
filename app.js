// =============================================
// CONFIGURACIÓN SUPABASE
// =============================================
const SUPABASE_URL = 'https://twpwrflhkltitynmgmva.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3cHdyZmxoa2x0aXR5bm1nbXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA2MjE1MjAsImV4cCI6MjA3NjE5NzUyMH0.uPE2HXF7dOKmAfwnnIpQ4Zmr156aHaSnOj68_ihxH-A';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// =============================================
// ESTADO GLOBAL
// =============================================
const state = {
  map: null,
  layers: {
    colonias: L.geoJSON(null),
    reportes: L.layerGroup(),
    buffers: L.layerGroup(),
    heatmap: L.layerGroup()
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
});

// =============================================
// MAPA
// =============================================
function initializeMap() {
  state.map = L.map('map').setView([22.254, -97.860], 13);

  // Capas base
  state.baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
    className: 'osm-tiles'
  });

  state.baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '© Esri',
    className: 'satellite-tiles'
  });

  // Agregar capa OSM por defecto
  state.baseLayers.osm.addTo(state.map);
  state.baseLayers.current = state.baseLayers.osm;

  // Agregar capas
  state.layers.colonias.addTo(state.map);
  state.layers.reportes.addTo(state.map);

  // Estilos de colonias
  state.layers.colonias.setStyle({
    color: '#3b82f6',
    weight: 1,
    fillOpacity: 0.08
  });

  // Eventos del mapa
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
    console.error('Error cargando datos:', error);
    showStatus('Error al cargar datos', 'error');
  }
}

async function loadColonias() {
  const { data, error } = await supabase.rpc('get_colonias_geojson');
  if (error) {
    console.error('Error cargando colonias:', error);
    return;
  }

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

      // Eventos en colonias
      state.layers.colonias.eachLayer(layer => {
        if (layer.feature.properties.gid === feature.properties.gid) {
          layer.on('click', (e) => handleColoniaClick(e, feature));
          if (feature.properties.nombre) {
            layer.bindTooltip(feature.properties.nombre);
          }
        }
      });
    }
  });
}

async function loadReportes() {
  const { data, error } = await supabase.rpc('get_reportes_geojson');
  if (error) {
    console.error('Error cargando reportes:', error);
    return;
  }

  state.data.reportes = data || [];
  applyFilters();
}

async function loadBuffers() {
  const { data, error } = await supabase.rpc('get_buffers_geojson');
  if (error) {
    console.error('Error cargando buffers:', error);
    return;
  }

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
    const estadoHTML = getStatusHTML(props.estado);
    const idUnico = props.identificador_unico || 'N/A';

    const popupContent = `
      <div class="popup-container">
        <div class="popup-header">
          <span class="popup-icon">📍</span>
          <div>
            <h3 class="popup-title">${props.tipo}</h3>
            <span class="popup-badge" style="background: ${color}20; color: ${color};">${props.tipo}</span>
          </div>
        </div>
        
        <div class="popup-content">
          <div class="popup-section">
            <p class="popup-description">${props.descripcion}</p>
          </div>

          <div class="popup-section">
            <h4 class="popup-section-title">📅 Información</h4>
            <div class="popup-info-item">
              <span class="popup-info-label">Fecha:</span>
              <span class="popup-info-value">${fechaFormato}</span>
            </div>
          </div>

          <div class="popup-status ${props.estado === 'Pendiente' || props.estado === 'nuevo' ? 'pendiente' : props.estado === 'En proceso' || props.estado === 'en proceso' ? 'en-proceso' : 'solucionado'}">
            ● ${props.estado === 'Pendiente' || props.estado === 'nuevo' ? 'Pendiente' : props.estado === 'En proceso' || props.estado === 'en proceso' ? 'En Proceso' : 'Solucionado'}
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
          <span class="popup-icon">🔥</span>
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
  // Asegurar que los elementos existan
  const btnMapSelect = document.getElementById('btnMapSelect');
  const btnLocationForm = document.getElementById('btnLocationForm');
  
  if (btnMapSelect) {
    btnMapSelect.addEventListener('click', startMapSelection);
  } else {
    console.warn('btnMapSelect no encontrado');
  }
  
  if (btnLocationForm) {
    btnLocationForm.addEventListener('click', handleLocateFromForm);
  } else {
    console.warn('btnLocationForm no encontrado');
  }

  // Búsqueda
  const searchInput = document.getElementById('searchCol');
  searchInput.addEventListener('input', (e) => handleSearchInput(e));

  document.getElementById('btnSearch').addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) searchColonia(query);
  });

  // Toggles de capas
  document.getElementById('toggleColonias').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.colonias.addTo(state.map);
      // Reordenar capas
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
      // Reordenar capas
      reorderLayers();
    } else {
      state.map.removeLayer(state.layers.buffers);
    }
  });

  document.getElementById('toggleHeatmap').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.heatmap.addTo(state.map);
    } else {
      state.map.removeLayer(state.layers.heatmap);
    }
  });

  document.getElementById('toggleHeatmap').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.layers.heatmap.addTo(state.map);
    } else {
      state.map.removeLayer(state.layers.heatmap);
    }
  });

  // Filtro por tipo
  document.getElementById('filterTipo').addEventListener('change', (e) => {
    state.filters.tipo = e.target.value;
    applyFilters();
    applyFilterBuffers();
  });

  // Cambio de tipo de mapa base
  document.querySelectorAll('input[name="mapBase"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      switchMapBase(e.target.value);
    });
  });

  // Botones de acción
  document.getElementById('btnAdd').addEventListener('click', openReportForm);
  document.getElementById('btnCancel').addEventListener('click', closeReportForm);
  document.getElementById('btnSubmit').addEventListener('click', submitReport);
  document.getElementById('btnMapSelect').addEventListener('click', startMapSelection);
  document.getElementById('btnLocationForm').addEventListener('click', handleLocateFromForm);
  document.getElementById('btnLocatePanel').addEventListener('click', handleLocatePanel);

  // Modales
  document.getElementById('btnHelp').addEventListener('click', () => openModal('helpModal'));
  document.getElementById('btnAbout').addEventListener('click', () => openModal('aboutModal'));
  document.getElementById('closeHelpBtn').addEventListener('click', () => closeModal('helpModal'));
  document.getElementById('closeAboutBtn').addEventListener('click', () => closeModal('aboutModal'));
  document.getElementById('closeFormBtn').addEventListener('click', closeReportForm);
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

  // Cerrar sugerencias
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

  suggestionsList.innerHTML = filtered.map(f =>
    `<div onclick="window.selectSuggestion('${f.properties.nombre}')">${f.properties.nombre}</div>`
  ).join('');
  suggestionsList.style.display = 'block';
}

window.selectSuggestion = function(nombre) {
  document.getElementById('searchCol').value = nombre;
  document.getElementById('suggestionsList').style.display = 'none';
  searchColonia(nombre);
};

async function searchColonia(query) {
  const { data, error } = await supabase.rpc('search_colonia', { p_name: query });
  if (error) {
    console.error('Error en búsqueda:', error);
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
      let info = `<b>${props.nombre}</b><br/>`;

      if (stats && stats.length > 0) {
        const stat = stats[0];
        let total = stat.total || 0;
        if (stat.by_tipo && Object.keys(stat.by_tipo).length > 0) {
          total = Object.values(stat.by_tipo).reduce((sum, cnt) => sum + cnt, 0);
        }
        info += `Reportes: ${total}<br/>`;
        if (stat.by_tipo && Object.keys(stat.by_tipo).length > 0) {
          const tipos = Object.entries(stat.by_tipo).map(([tipo, cnt]) => `${tipo}: ${cnt}`).join('<br/>');
          info += `Tipos:<br/>${tipos}`;
        }
      } else {
        info += 'Reportes: 0';
      }

      layer.bindPopup(info, { closeButton: true, autoClose: false });
      layer.openPopup();
      
      // Al cerrar el popup, recargar todas las colonias
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
            <span class="popup-stat-label">${tipo}:</span>
            <span class="popup-stat-value">${cnt}</span>
          </div>
        `)
        .join('');
      
      statsHTML = `
        <div class="popup-stats">
          <div class="popup-stat-item" style="font-weight: 700; margin-bottom: 0.8rem;">
            <span style="color: var(--dark);">Total:</span>
            <span class="popup-stat-value">${total}</span>
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

  const popupContent = `
    <div class="popup-container">
      <div class="popup-header">
        <span class="popup-icon">🏘️</span>
        <div>
          <h3 class="popup-title">${feature.properties.nombre || 'Sin nombre'}</h3>
          <span class="popup-badge" style="background: var(--primary)20; color: var(--primary);">Colonia</span>
        </div>
      </div>
      
      <div class="popup-content">
        <div class="popup-section">
          <h4 class="popup-section-title">📊 Estadísticas de Reportes</h4>
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

function handleLocateFromForm() {
  console.log('handleLocateFromForm ejecutado');
  
  if (!navigator.geolocation) {
    showStatus('Geolocalización no disponible', 'error');
    return;
  }

  showStatus('Obteniendo tu ubicación...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      console.log('Ubicación obtenida:', lat, lng);
      
      state.map.setView([lat, lng], 17);

      if (state.form.tempMarker) {
        state.map.removeLayer(state.form.tempMarker);
      }

      state.form.tempMarker = L.marker([lat, lng])
        .addTo(state.map)
        .bindPopup('Tu ubicación')
        .openPopup();

      state.form.location = { lat, lng };
      document.getElementById('locDisplay').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('locDisplay').classList.add('active');
      showStatus('✓ Ubicación obtenida', 'success');
    },
    (err) => {
      console.error('Error de geolocalización:', err);
      showStatus('Error: ' + err.message, 'error');
    }
  );
}

function handleLocatePanel() {
  console.log('handleLocatePanel ejecutado');
  
  if (!navigator.geolocation) {
    showStatus('Geolocalización no disponible', 'error');
    return;
  }

  showStatus('Obteniendo tu ubicación...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      console.log('Ubicación obtenida (panel):', lat, lng);
      
      // Solo hacer zoom, sin abrir formulario
      state.map.setView([lat, lng], 17);

      // Limpiar marcador anterior si existe
      if (state.form.tempMarker) {
        state.map.removeLayer(state.form.tempMarker);
      }

      // Crear marcador temporal para mostrar ubicación
      state.form.tempMarker = L.marker([lat, lng])
        .addTo(state.map)
        .bindPopup('Tu ubicación actual')
        .openPopup();

      showStatus('✓ Ubicación centrada', 'success');
    },
    (err) => {
      console.error('Error de geolocalización:', err);
      showStatus('Error: ' + err.message, 'error');
    }
  );
}

function startMapSelection() {
  console.log('startMapSelection ejecutado');
  
  // Cerrar modal
  closeModal('formModal');
  state.form.open = true;
  
  // Ocultar colonias
  if (state.map.hasLayer(state.layers.colonias)) {
    state.map.removeLayer(state.layers.colonias);
  }
  document.getElementById('toggleColonias').checked = false;
  
  // Agregar cursor crosshair
  document.getElementById('map').classList.add('crosshair');
  
  state.form.location = null;
  document.getElementById('locDisplay').classList.remove('active');
  showStatus('Haz click en el mapa para seleccionar ubicación', 'info');
}

function handleMapClick(e) {
  if (!state.form.open) return;

  const { lat, lng } = e.latlng;
  console.log('Click en mapa:', lat, lng);
  verifyLocationInColonia(lat, lng);
}

async function verifyLocationInColonia(lat, lng) {
  try {
    const { data, error } = await supabase.rpc('st_contains_point', {
      p_lat: lat,
      p_long: lng
    });

    if (error) {
      console.error('Error verificando ubicación:', error);
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

    state.form.tempMarker = L.marker([lat, lng]).addTo(state.map);
    document.getElementById('locDisplay').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    document.getElementById('locDisplay').classList.add('active');
    showStatus('✓ Ubicación seleccionada', 'success');
    
    // Reabrir modal después de 800ms
    setTimeout(() => {
      state.form.open = false;
      document.getElementById('map').classList.remove('crosshair');
      document.getElementById('toggleColonias').checked = true;
      state.layers.colonias.addTo(state.map);
      openModal('formModal');
    }, 800);
  } catch (err) {
    console.error('Error en verifyLocationInColonia:', err);
    showStatus('Error procesando ubicación', 'error');
  }
}

function openReportForm() {
  state.form.open = false;
  openModal('formModal');
  state.form.location = null;
  document.getElementById('locDisplay').textContent = 'Selecciona una ubicación';
  document.getElementById('locDisplay').classList.remove('active');
  showStatus('Abre el formulario de reporte', 'info');
  
  // Cerrar panel en móvil
  closePanel();
}

function closeReportForm() {
  state.form.open = false;
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
  
  // Limpiar foto
  state.form.foto = null;
  state.form.fotoFile = null;
  document.getElementById('fileName').textContent = 'Selecciona una imagen';
  
  loadColonias();
}

async function submitReport() {
  const nombre = document.getElementById('inputNombre').value.trim() || 'Anónimo';
  const correo = document.getElementById('inputCorreo').value.trim() || null;
  const tipo = document.getElementById('inputTipo').value.trim();
  const desc = document.getElementById('inputDesc').value.trim();

  if (!state.form.location) {
    showStatus('Selecciona una ubicación', 'error');
    return;
  }

  if (!tipo) {
    showStatus('Selecciona tipo de problemática', 'error');
    return;
  }

  if (!desc) {
    showStatus('Describe el problema', 'error');
    return;
  }

  const btnSubmit = document.getElementById('btnSubmit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Enviando...';

  try {
    console.log('Iniciando envío de reporte...');
    
    // Insertar el reporte
    const { data: reportData, error: reportError } = await supabase.rpc('insert_report', {
      p_nombre: nombre,
      p_tipo: tipo,
      p_descripcion: desc,
      p_lat: state.form.location.lat,
      p_long: state.form.location.lng,
      p_correo: correo
    });

    console.log('Respuesta del servidor:', reportData, reportError);

    if (reportError) {
      console.error('Error al enviar reporte:', reportError);
      showStatus('Error: ' + (reportError.message || 'Hubo un error al enviar el reporte'), 'error');
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Enviar Reporte';
      return;
    }

    if (!reportData) {
      console.error('reportData es null o undefined');
      showStatus('Reporte enviado correctamente', 'success');
      closeReportForm();
      setTimeout(async () => {
        await loadAllData();
      }, 1000);
      return;
    }

    // Si reportData es un array
    let reportId = null;
    if (Array.isArray(reportData) && reportData.length > 0) {
      reportId = reportData[0].id;
    } 
    // Si reportData es un objeto
    else if (typeof reportData === 'object' && reportData.id) {
      reportId = reportData.id;
    }
    // Si es un número directo (algunas funciones retornan solo el ID)
    else if (typeof reportData === 'number') {
      reportId = reportData;
    }

    console.log('ID del reporte obtenido:', reportId);

    // Si hay foto, intentar subirla (pero no bloquea el reporte si falla)
    if (state.form.fotoFile) {
      try {
        // Limpiar el nombre del archivo de caracteres especiales
        const fileExtension = state.form.fotoFile.name.split('.').pop().toLowerCase();
        const cleanFileName = `${reportId}_${Date.now()}.${fileExtension}`;
        
        console.log('Intentando subir foto:', cleanFileName);
        console.log('Tamaño del archivo:', state.form.fotoFile.size, 'bytes');
        console.log('Tipo de archivo:', state.form.fotoFile.type);
        
        // Convertir archivo a blob para asegurar compatibilidad
        const blob = new Blob([state.form.fotoFile], { type: state.form.fotoFile.type });
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('reporte_fotos')
          .upload(`reportes/${cleanFileName}`, blob, {
            contentType: state.form.fotoFile.type,
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error('Error al subir foto:', uploadError);
          console.warn('Error al subir foto, pero continuando con reporte...');
          showStatus('✓ Reporte enviado (foto no se pudo guardar)', 'success');
        } else {
          console.log('Foto subida exitosamente:', uploadData);
          
          // Obtener el identificador_unico del reporte recién creado
          const { data: reporteData, error: fetchError } = await supabase
            .from('Reportes')
            .select('identificador_unico')
            .eq('id', reportId)
            .single();
          
          if (fetchError) {
            console.error('Error al obtener identificador_unico:', fetchError);
            showStatus('✓ Foto subida pero no se registró en BD', 'success');
          } else if (reporteData && reporteData.identificador_unico) {
            // Insertar en reporte_fotos con identificador_unico
            const { error: fotoError } = await supabase
              .from('reporte_fotos')
              .insert([{
                identificador_unico: reporteData.identificador_unico,
                storage_path: `reportes/${cleanFileName}`,
                storage_file_name: cleanFileName,
                nombre_archivo: state.form.fotoFile.name,
                tamano_bytes: state.form.fotoFile.size,
                tipo_archivo: state.form.fotoFile.type
              }]);
            
            if (fotoError) {
              console.error('Error al registrar foto en BD:', fotoError);
              showStatus('✓ Foto subida pero no se registró en BD', 'success');
            } else {
              console.log('Foto registrada en BD correctamente');
              showStatus('✓ ¡Reporte y foto enviados correctamente!', 'success');
            }
          }
        }
      } catch (fotoError) {
        console.error('Exception al subir foto:', fotoError);
        console.warn('Error crítico al subir foto, pero continuando con reporte...');
        showStatus('✓ Reporte enviado correctamente', 'success');
      }
    } else {
      showStatus('✓ ¡Reporte enviado correctamente!', 'success');
    }

    closeReportForm();
    setTimeout(async () => {
      await loadAllData();
    }, 1000);

  } catch (err) {
    console.error('Error general en submitReport:', err);
    showStatus('Error procesando reporte: ' + err.message, 'error');
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Enviar Reporte';
  }
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  
  if (!file) {
    return;
  }

  console.log('Archivo seleccionado:', file.name, 'Tamaño:', file.size);

  // Validar tipo de archivo
  if (!file.type.startsWith('image/')) {
    console.warn('Tipo de archivo inválido:', file.type);
    showStatus('Por favor selecciona una imagen válida', 'error');
    e.target.value = '';
    state.form.fotoFile = null;
    state.form.foto = null;
    return;
  }

  // Validar tamaño (máximo 5MB)
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    console.warn('Archivo muy grande:', file.size);
    showStatus('La imagen es muy grande. Máximo 5MB', 'error');
    e.target.value = '';
    state.form.fotoFile = null;
    state.form.foto = null;
    return;
  }

  // Guardar archivo
  state.form.fotoFile = file;

  // Mostrar preview
  const reader = new FileReader();
  reader.onload = (event) => {
    state.form.foto = event.target.result;
    document.getElementById('previewImg').src = state.form.foto;
    document.getElementById('photoPreview').style.display = 'block';
    document.getElementById('fileName').textContent = file.name;
    showStatus('✓ Imagen seleccionada', 'success');
  };
  reader.onerror = () => {
    console.error('Error al leer archivo');
    showStatus('Error al leer la imagen', 'error');
    e.target.value = '';
    state.form.fotoFile = null;
    state.form.foto = null;
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  console.log('Removiendo foto');
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
  const modal = document.getElementById(modalId);
  modal.classList.add('show');
  
  // Cerrar panel en móvil al abrir cualquier modal
  closePanel();
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
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
  console.log('Cambiando a mapa base:', baseType);
  
  // Remover capa actual
  if (state.baseLayers.current) {
    state.map.removeLayer(state.baseLayers.current);
  }

  // Agregar nueva capa
  if (baseType === 'osm') {
    state.baseLayers.osm.addTo(state.map);
    state.baseLayers.current = state.baseLayers.osm;
    showStatus('Mapa Base activado', 'info');
  } else if (baseType === 'satellite') {
    state.baseLayers.satellite.addTo(state.map);
    state.baseLayers.current = state.baseLayers.satellite;
    showStatus('Vista de Satélite activada', 'info');
  }

  // Traer capas al frente
  reorderLayers();
}

function reorderLayers() {
  // Remover y agregar en el orden correcto para mantener Z-index
  if (state.map.hasLayer(state.layers.colonias)) {
    state.map.removeLayer(state.layers.colonias);
    state.map.addLayer(state.layers.colonias);
  }
  
  if (state.map.hasLayer(state.layers.buffers)) {
    state.map.removeLayer(state.layers.buffers);
    state.map.addLayer(state.layers.buffers);
  }
  
  // Reportes siempre al frente
  if (state.map.hasLayer(state.layers.reportes)) {
    state.map.removeLayer(state.layers.reportes);
    state.map.addLayer(state.layers.reportes);
  }
  
  // Heatmap al frente si está activo
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
  const opciones = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Mexico_City'
  };
  return fecha.toLocaleDateString('es-MX', opciones);
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
