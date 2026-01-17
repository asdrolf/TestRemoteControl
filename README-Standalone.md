# TestRemoteControl - Standalone Launcher

Este proyecto ahora incluye un script standalone que facilita el arranque tanto del cliente como del servidor para acceso en red local.

## Requisitos

- **Node.js** (versión 16 o superior)
- **Windows PowerShell** (incluido en Windows)

## Inicio Rápido

1. **Descarga o clona el proyecto**
   ```powershell
   git clone <repository-url>
   cd TestRemoteControl
   ```

2. **Ejecuta el script standalone**
   ```powershell
   .\start-standalone.ps1
   ```

El script automáticamente:
- ✅ Verifica que Node.js esté instalado
- ✅ Instala dependencias del cliente y servidor (si es necesario)
- ✅ Detecta las direcciones IP locales de tu máquina
- ✅ Arranca el servidor en segundo plano (puerto 3001)
- ✅ Arranca el cliente en segundo plano (puerto 5173)
- ✅ Muestra las URLs accesibles

## Acceso a la Aplicación

Una vez ejecutado el script, podrás acceder a:

### Interfaz Web (Cliente)
- **Local:** http://localhost:5173
- **Red Local:** http://[TU_IP]:5173 (ej: http://192.168.1.100:5173)

### API del Servidor (WebSocket/HTTP)
- **Local:** http://localhost:3001
- **Red Local:** http://[TU_IP]:3001

## Acceso desde Otros Dispositivos

Para acceder desde teléfonos, tablets u otros computadores en la misma red:

1. Ejecuta el script `start-standalone.ps1`
2. El script mostrará todas las direcciones IP disponibles
3. Usa cualquiera de las direcciones IP mostradas + el puerto correspondiente
4. Asegúrate de que el firewall de Windows permita conexiones en los puertos 3001 y 5173

## Detención de Servicios

Para detener los servicios:
- Cierra la ventana de PowerShell (Ctrl+C)
- O presiona Ctrl+C en la terminal donde se ejecuta el script

## Solución de Problemas

### Error de permisos de ejecución
Si PowerShell bloquea la ejecución del script:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Puerto ocupado
Si los puertos 3001 o 5173 están ocupados:
- Cierra otras instancias de la aplicación
- O modifica los puertos en los archivos de configuración

### No se detectan IPs de red
Si el script no detecta las direcciones IP automáticamente:
- Verifica tu conexión de red
- Las URLs seguirán funcionando con `localhost`

## Estructura del Proyecto

```
TestRemoteControl/
├── client/                 # Interfaz web React/Vite
├── server/                 # API backend Node.js
├── vscode-extension/       # Extensión para VSCode
├── start-standalone.ps1    # Script de arranque standalone
└── README-Standalone.md    # Este archivo
```

## Desarrollo

Para desarrollo individual de componentes:

```powershell
# Solo servidor
cd server
npm start

# Solo cliente
cd client
npm run dev
```

## Configuración Avanzada

- **Puerto del servidor:** Modificar `server/config.js` (PORT: 3001)
- **Puerto del cliente:** Modificar `client/vite.config.js` (port: 5173)
- **Configuración detallada:** Ver `server/config.json` y `server/CONFIG_README.md`