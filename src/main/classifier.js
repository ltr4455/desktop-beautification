'use strict';
/**
 * 分类规则引擎（纯函数，无 Electron 依赖，可单测）。
 * 类别 ID：app 应用 / game 游戏 / folder 文件夹 / image 图片 / doc 文档 /
 *         media 音视频 / archive 压缩包 / link 网页链接 / other 其他
 */

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico',
  '.heic', '.heif', '.avif', '.tif', '.tiff', '.raw', '.psd', '.ai',
  '.eps', '.indd', '.cdr', '.dng', '.cr2', '.nef', '.arw',
]);
const DOC_EXTS = new Set([
  '.txt', '.md', '.markdown', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.pdf', '.epub', '.mobi', '.csv', '.json', '.xml', '.rtf', '.odt', '.ods', '.odp',
  '.log', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.tsv', '.sql', '.tex',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.py', '.java', '.c', '.cc', '.cpp',
  '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.sh',
  '.dockerfile', '.env', '.gitignore',
]);
const MEDIA_EXTS = new Set([
  '.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.wma', '.opus',
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.m4v', '.ts', '.rmvb',
  '.3gp', '.mpeg', '.mpg', '.m2ts', '.m3u', '.m3u8', '.pls',
]);
const ARCHIVE_EXTS = new Set([
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.cab',
  '.tgz', '.tbz2', '.zst', '.zipx', '.lzh', '.lz', '.lzma', '.wim', '.vhd', '.vhdx',
]);
const APP_EXTS = new Set([
  '.exe', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.bat', '.cmd',
  '.ps1', '.vbs', '.wsf', '.com', '.scr', '.jar', '.apk',
]);

/** 常见游戏平台安装目录特征（路径不区分大小写） */
const GAME_HINTS = [
  'steamapps\\common', 'steamapps', 'steam library', 'steam\\steamapps',
  'epic games', 'gog games', 'wegame', 'battlenet', 'battle.net',
  'riot games', 'ubisoft game launcher', 'xboxgames', 'xbox games',
  'origin games', 'ea games',
  '5eplay', '5e\u5bf9\u6218\u5e73\u53f0', '\u5bf9\u6218\u5e73\u53f0', '\u6ce8\u518c\u8868',
];

/** 启动器本身属于「应用」，避免把 Steam / Epic / Battle.net 误当成具体游戏。 */
const GAME_LAUNCHERS = new Set([
  'steam.exe', 'epicgameslauncher.exe', 'epicwebhelper.exe', 'battle.net.exe',
  'battlenet.exe', 'riotclientservices.exe', 'ubisoftconnect.exe', 'uplay.exe',
  'eadesktop.exe', 'origin.exe', 'wegamelauncher.exe', 'xboxpcapp.exe',
]);

const CATEGORIES = [
  { id: 'app',    label: '应用',   icon: 'app' },
  { id: 'game',   label: '游戏',   icon: 'game' },
  { id: 'folder', label: '文件夹', icon: 'folder' },
  { id: 'image',  label: '图片',   icon: 'image' },
  { id: 'doc',    label: '文档',   icon: 'doc' },
  { id: 'media',  label: '音视频', icon: 'media' },
  { id: 'archive',label: '压缩包', icon: 'archive' },
  { id: 'link',   label: '网页链接', icon: 'link' },
  { id: 'other',  label: '其他',   icon: 'other' },
];

function categoryMeta(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return '';
  return name.slice(i).toLowerCase();
}

function isGameTarget(targetPath) {
  if (!targetPath) return false;
  const p = targetPath.replace(/\//g, '\\').toLowerCase();
  const base = p.slice(p.lastIndexOf('\\') + 1);
  if (GAME_LAUNCHERS.has(base)) return false;
  return GAME_HINTS.some((h) => p.includes(h.toLowerCase()));
}

/**
 * 分类一个桌面条目。
 * @param {object} item { name, ext, isDir, targetPath }
 * @returns {string} 类别 ID
 */
function classifyItem(item = {}) {
  const { name = '', ext = null, isDir = false, targetPath = '' } = item;
  if (isDir) return 'folder';
  const e = (ext != null ? ext : extOf(name)).toLowerCase();

  if (e === '.url' || e === '.website' || e === '.webloc') {
    // 非 http(s) 的自定义协议（steam://、fevergames:// 等游戏/客户端启动器）视为应用快捷方式
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(targetPath) && !/^https?:\/\//i.test(targetPath)) return 'app';
    return 'link';
  }

  if (e === '.lnk') {
    if (/^https?:\/\//i.test(targetPath)) return 'link';
    const t = targetPath || '';
    const tExt = extOf(t).replace(/^\./, '');
    if (isGameTarget(t)) return 'game';
    if (tExt) {
      if (tExt === 'lnk') return 'other';
      return 'app'; // 指向可执行文件或其它文件的应用快捷方式
    }
    return 'app';
  }

  if (IMAGE_EXTS.has(e)) return 'image';
  if (DOC_EXTS.has(e)) return 'doc';
  if (MEDIA_EXTS.has(e)) return 'media';
  if (ARCHIVE_EXTS.has(e)) return 'archive';
  if (APP_EXTS.has(e)) return 'app';
  return 'other';
}

/** 判断名称是否应被跳过（隐藏/系统/临时文件启发式） */
function isSkippableName(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  if (lower === 'desktop.ini' || lower === 'thumbs.db' || lower === '.ds_store') return true;
  if (lower.startsWith('~$') || lower.startsWith('.')) return true;
  if (lower.endsWith('.tmp') || lower.endsWith('.temp') || lower.endsWith('.partial')) return true;
  return false;
}

module.exports = { CATEGORIES, categoryMeta, classifyItem, extOf, isSkippableName, isGameTarget };
