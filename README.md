# MSR · HCE Control

PWA estática para sustituir el libro Excel/VBA de seguimiento MSR/HCE.

## Funciones

- Inicio con KPIs.
- Resumen MSR con filtros de Pendiente, Retraso, Parcial y Expedido.
- Editar estados:
  - búsqueda de varias IDs,
  - estado persistente por ID,
  - Total/Parcial,
  - pallets,
  - Serval y comentarios,
  - mostrar/ocultar histórico,
  - borrar histórico con doble confirmación.
- Contenedores HCE:
  - fecha/hora real,
  - estado de descarga,
  - muelle,
  - matriculado, ubicado, 5 %, muestra,
  - avisos operativos.
- Importación `.xlsx`, `.xls` y `.csv`.
- Copias de seguridad JSON.
- PWA instalable en móvil y escritorio.
- GitHub Pages.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `msr-hce-control`.
2. Sube **todo el contenido de esta carpeta** a la raíz del repositorio.
3. En GitHub abre `Settings` → `Pages`.
4. En `Build and deployment`, selecciona **GitHub Actions**.
5. Haz un commit/push a `main` o `master`.
6. La acción `Deploy GitHub Pages` publicará la app.

La URL será normalmente:

`https://TU-USUARIO.github.io/msr-hce-control/`

Si el repositorio se llama exactamente `TU-USUARIO.github.io`, la URL será:

`https://TU-USUARIO.github.io/`

## Datos

Esta primera versión guarda los datos en `localStorage` del navegador.

Ventajas:
- no necesita servidor;
- funciona en GitHub Pages;
- muy estable;
- la app puede instalarse como PWA.

Limitación:
- cada navegador/dispositivo tiene su propia copia.

Para varios usuarios trabajando sobre los mismos datos en tiempo real, el siguiente paso es conectar **Supabase** o **Firebase**.

## Excel

La importación usa SheetJS desde jsDelivr y busca automáticamente nombres de columnas habituales de los exports MSR/HCE.

Los estados manuales se conservan por ID cuando vuelves a importar MSR.
