/**
 * firebase.ts — DEPRECATED
 *
 * This project now uses Google Identity Services (GIS) for authentication
 * instead of the Firebase SDK.  This file is kept as a no-op stub so that
 * any remaining import statements don't break the build.
 *
 * Safe to delete once all `import … from "../firebase"` references are removed.
 *
 * The GIS library is loaded via the <script> tag in index.html and wrapped
 * by src/gis-auth.ts.
 */

export {};
