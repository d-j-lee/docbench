declare module '*.css' {
  const css: string;
  export default css;
}

// File System Access API — Chromium(엣지·크롬)에만 있고 TypeScript 기본 선언에 없는 부분
interface FileSystemHandlePermissionDescriptor { mode?: 'read' | 'readwrite' }
interface FileSystemHandle {
  queryPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface Window {
  showDirectoryPicker?(o?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string | FileSystemHandle }): Promise<FileSystemDirectoryHandle>;
}

/** 빌드가 package.json 의 version 으로 바꿔 넣는다 */
declare const __DOCBENCH_VERSION__: string;
