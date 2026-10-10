# Caza estrellas

Minijuego para una clase de GitHub. Cada persona abre la misma página, entra con un código de sala y mueve su personaje con **WASD** o las **flechas**. Todos ven a los demás en un mapa compartido de **21 × 13 casillas**. Cada estrella recogida suma un punto; gana quien tenga más puntos cuando se acaba el tiempo.

El sitio es estático: se publica en GitHub Pages con una sola carpeta y sin compilar nada. **Firebase Realtime Database** sincroniza posiciones, puntos, la salida de nuevas estrellas y el inicio de la partida. El botón **Jugadores** abre un panel que se puede cerrar. Los servicios se configuran una vez; luego el equipo trabaja en los archivos de personalización con ramas, pull requests y revisiones.

## Prueba inmediata

Abre `index.html`, escribe un nombre y pulsa **Probar solo**. Puedes recorrer el mapa y sumar puntos durante el tiempo elegido antes de configurar nada. La prueba individual no sincroniza con otros navegadores.

## Cómo se juega en equipo

1. Quien crea la sala elige **1, 2 o 3 minutos**; el valor inicial es **1 minuto**. Luego comparte el código o pulsa **Copiar enlace**.
2. Los demás abren la misma página publicada, escriben su nombre y entran con el código. La sala espera sin consumir tiempo.
3. Cuando estén listos, **cualquiera pulsa Iniciar partida**. Aparecen ocho estrellas y sale una tanda nueva cada **6 segundos**. Una estrella da **1 punto** a quien la recoge primero.
4. Al terminar el reloj se detiene el movimiento y aparece quién ganó. Si varias personas tienen la puntuación más alta, se muestra un empate. El botón **Jugadores** deja ver los puntos durante la partida.

Quien entre después del inicio juega con el tiempo que quede. Una sala terminada no se puede volver a iniciar; crea otra para repetir.

## Configuración inicial

Haz esto **antes de la clase**. No necesitas usar la línea de comandos.

1. Entra a [Firebase Console](https://console.firebase.google.com/) y crea un proyecto en el plan **Spark**. Registra una aplicación **Web** (icono `</>`). No necesitas activar Firebase Hosting ni Analytics.
2. En Firebase, abre **Authentication → Sign-in method** y activa el proveedor **Anónimo**. Los alumnos entrarán al juego sin crear otra cuenta.
3. Abre **Realtime Database** y crea la base en **modo bloqueado**. Elige una región y guarda. En la pestaña **Reglas**, sustituye las reglas por el contenido completo de [`firebase.rules.json`](firebase.rules.json) y pulsa **Publicar**. Estas reglas permiten crear la sala, iniciar el reloj, actualizar los personajes y asignar cada estrella una sola vez mientras dura la partida. Si ya habías publicado reglas de una versión anterior, vuelve a publicar este archivo completo.
4. En **Configuración del proyecto → Tus apps → Aplicación web**, elige la pestaña **Config** y copia el bloque completo `const firebaseConfig = { ... };`. Si creaste Realtime Database después de registrar la app, vuelve a obtener el objeto para que incluya `databaseURL`.
5. Reemplaza todo el contenido de [`firebase-config.js`](firebase-config.js) con ese bloque. Puedes dejar los campos extra como `storageBucket`, `messagingSenderId` y `measurementId`: el juego funciona con ellos. **No** copies las líneas de `npm install`, `import`, `initializeApp` ni `getAnalytics` que aparecen en la pestaña **npm**. Es la configuración pública de la aplicación web; **no** pegues una clave privada ni una cuenta de servicio.
6. Prueba la partida publicada desde **dos navegadores o dispositivos diferentes**: crea sala en uno, entra con el código en el otro, pulsa **Iniciar partida** y comprueba que se ven los personajes, los puntos, las nuevas tandas de estrellas y el resultado. Si aparece `auth/unauthorized-domain`, agrega el dominio de tu sitio de GitHub Pages en **Authentication → Settings → Authorized domains**.

La configuración web de Firebase identifica el proyecto, pero no protege los datos. Esa protección depende de las reglas que publiques en el paso 3. Consulta la [documentación de Firebase sobre claves y reglas](https://firebase.google.com/docs/projects/api-keys).

### Publicar en GitHub Pages

1. Crea un repositorio público en GitHub y sube **todos los archivos y carpetas de este proyecto a la raíz** del repositorio.
2. Abre **Settings → Pages**. En **Build and deployment** elige **Deploy from a branch**, `main` y `/ (root)`. Guarda.
3. Abre la URL que muestra GitHub Pages. Crea la sala **desde esa URL** y comparte el código o usa **Copiar enlace**.

Puedes usar **el mismo proyecto Firebase para varios equipos**: cada equipo crea una sala con un código diferente. No hace falta que cada estudiante cree una base de datos. Antes de la clase, publica una versión completa y probada para que todos partan del mismo proyecto.

## Archivos para el taller

| Archivo | Para qué sirve |
| --- | --- |
| `personalizar.js` | Título, mensajes y colores del juego. |
| `styles.css` | Aspecto de los botones, tarjetas y página. |
| `firebase-config.js` | Conexión a Firebase. Se prepara antes de clase. |
| `firebase.rules.json` | Reglas que se pegan una vez en Firebase Console. |
| `game.js` | Movimiento, salas y sincronización. Ya funciona. |

### Actividad colaborativa sugerida

1. Forma equipos de 3 o 4 y entrega el proyecto preparado. Cada equipo trabaja en un repositorio compartido.
2. Cada integrante crea una rama y modifica **una cosa visible** con ayuda de IA: paleta de colores, textos, estilo de tarjetas o iconos. Puede pedirle a la IA: *«Modifica solo `personalizar.js` para dar al juego una temática submarina; conserva los nombres de las propiedades y no toques Firebase»*.
3. Cada quien prueba su cambio, hace commit, sube la rama y abre un pull request con una captura o breve explicación.
4. Cada integrante revisa el pull request de otra persona. Integran los cambios y resuelven juntos cualquier conflicto.
5. Actualizan GitHub Pages y entran a una sala del equipo para jugar la versión final.

**Nota:** durante una partida todos deben abrir la misma versión publicada. Si cambian los archivos mientras alguien juega, recarguen la página y creen una sala nueva.
