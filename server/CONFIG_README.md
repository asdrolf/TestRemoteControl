# Sistema de Configuración

## Resumen

Se ha implementado un sistema de configuración centralizado y persistente que reemplaza el anterior enfoque basado en localStorage del cliente.

## Características

- **Persistencia centralizada**: La configuración se guarda en `server/config.json`
- **Configuraciones globales y por cliente**: Separación clara entre configuraciones compartidas y específicas de cada cliente
- **API unificada**: Interfaz consistente para acceder y modificar configuraciones
- **Validación**: Todas las configuraciones se validan antes de aplicarse
- **Configuración de consola**: Soporte completo para personalización de terminal/consola

## Estructura de Configuración

### Configuraciones Globales
- `screenConfig`: Región base de captura de pantalla
- `chatCrop`/`terminalCrop`: Recortes para diferentes modos de vista
- `fps`, `quality`: Configuraciones de stream por defecto
- `scrollSensitivity`: Sensibilidad del scroll por defecto
- `targetWindowTitles`: Títulos de ventana para detección automática
- `detectionInterval`: Intervalo de detección de ventanas
- `showDebugLines`: Mostrar líneas de depuración
- `console`: Configuración completa de la consola (fuentes, colores, cursores, etc.)

### Configuraciones por Cliente
- Overrides de configuraciones globales (`fps`, `quality`, etc.)
- Preferencias de UI (`theme`, `fabPosition`)
- Overrides de configuración de consola

## API del Servidor

### Métodos principales

```javascript
const configManager = require('./configManager');

// Obtener configuración global
const globalConfig = configManager.getGlobalConfig();

// Actualizar configuración global
await configManager.updateGlobalConfig({
  fps: 60,
  console: { fontSize: 16 }
});

// Obtener configuración efectiva para un cliente
const effectiveConfig = configManager.getEffectiveConfig(socketId, 'chat');

// Actualizar configuración de cliente
configManager.updateClientConfig(socketId, {
  theme: 'light',
  fps: 45 // Override global fps
});
```

## Eventos de Socket

### Cliente → Servidor
- `config:get`: Solicitar configuración actual
- `config:update`: Actualizar configuración

### Servidor → Cliente
- `config:current`: Enviar configuración actual al cliente

## Migración

El sistema es compatible con versiones anteriores. Las configuraciones existentes se migran automáticamente.

## Configuración de Consola

La configuración de consola incluye:

- **Fuente**: Tamaño, familia, interlineado, espaciado
- **Apariencia**: Tema de colores, estilo de cursor, parpadeo
- **Colores**: Paleta completa de colores ANSI (16 colores + bright variants)

## Archivos

- `configManager.js`: Lógica principal del sistema de configuración
- `config.js`: Interfaz de compatibilidad con código existente
- `config.json`: Archivo de configuración persistente (creado automáticamente)
- `config.example.json`: Ejemplo de estructura de configuración