import type { Project, ProjectColor } from './types';

export interface ProjectColorMeta {
  key: ProjectColor;
  dot: string;
  soft: string;
  labelZh: string;
  labelEn: string;
}

export const PROJECT_COLOR_PALETTE: readonly ProjectColorMeta[] = [
  { key: 'blue', dot: '#007AFF', soft: 'rgba(0, 122, 255, 0.12)', labelZh: '海蓝', labelEn: 'Blue' },
  { key: 'indigo', dot: '#5856D6', soft: 'rgba(88, 86, 214, 0.12)', labelZh: '靛青', labelEn: 'Indigo' },
  { key: 'purple', dot: '#AF52DE', soft: 'rgba(175, 82, 222, 0.12)', labelZh: '紫罗兰', labelEn: 'Purple' },
  { key: 'pink', dot: '#FF2D55', soft: 'rgba(255, 45, 85, 0.12)', labelZh: '莓红', labelEn: 'Pink' },
  { key: 'orange', dot: '#FF9500', soft: 'rgba(255, 149, 0, 0.13)', labelZh: '琥珀橙', labelEn: 'Orange' },
  { key: 'green', dot: '#34C759', soft: 'rgba(52, 199, 89, 0.13)', labelZh: '翠绿', labelEn: 'Green' },
  { key: 'teal', dot: '#0D9488', soft: 'rgba(13, 148, 136, 0.12)', labelZh: '青碧', labelEn: 'Teal' },
  { key: 'slate', dot: '#64748B', soft: 'rgba(100, 116, 139, 0.14)', labelZh: '石墨灰', labelEn: 'Slate' },
] as const;

export const PROJECT_COLOR_MAP: Record<ProjectColor, ProjectColorMeta> = PROJECT_COLOR_PALETTE.reduce(
  (acc, item) => {
    acc[item.key] = item;
    return acc;
  },
  {} as Record<ProjectColor, ProjectColorMeta>,
);

export function isProjectColor(value: unknown): value is ProjectColor {
  return typeof value === 'string' && value in PROJECT_COLOR_MAP;
}

export function resolveProjectColor(color: unknown, seed = ''): ProjectColor {
  if (isProjectColor(color)) return color;
  if (!seed) return 'blue';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PROJECT_COLOR_PALETTE[hash % PROJECT_COLOR_PALETTE.length].key;
}

export function getProjectColorMeta(project: Pick<Project, 'id' | 'color'> | null | undefined): ProjectColorMeta {
  if (!project) return PROJECT_COLOR_MAP.slate;
  return PROJECT_COLOR_MAP[resolveProjectColor(project.color, project.id)];
}

export function pickNextProjectColor(existingCount: number): ProjectColor {
  return PROJECT_COLOR_PALETTE[existingCount % PROJECT_COLOR_PALETTE.length].key;
}
