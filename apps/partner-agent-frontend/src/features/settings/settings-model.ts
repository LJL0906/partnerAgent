import type { AuthStatus } from '@/features/auth';
import type { AppIconName } from '@/components/ui/app-icon';
import type { StatusBadgeTone } from '@/components/ui/status-badge';

export type SettingsItem = {
  title: string;
  subtitle: string;
  icon: AppIconName;
  placeholder?: boolean;
};

export type SettingsSection = { title: string; items: SettingsItem[] };

export const settingsSections: SettingsSection[] = [
  {
    title: '账户与安全',
    items: [
      { title: '个人资料', subtitle: '管理你的头像与个人信息', icon: 'profile' },
      { title: '安全会话', subtitle: '查看当前登录状态与令牌有效期', icon: 'shield' },
    ],
  },
  {
    title: 'AI 与模型',
    items: [
      { title: '模型设置', subtitle: '选择默认模型与推理偏好', icon: 'sparkle', placeholder: true },
      { title: '记忆与上下文', subtitle: '管理助手如何记住和使用信息', icon: 'memory', placeholder: true },
    ],
  },
  {
    title: '通用设置',
    items: [
      { title: '通知设置', subtitle: '管理提醒与消息通知', icon: 'info', placeholder: true },
      { title: '外观设置', subtitle: '主题、动效与交互偏好', icon: 'sparkle', placeholder: true },
      { title: '隐私与数据', subtitle: '管理数据使用与本地存储', icon: 'lock', placeholder: true },
    ],
  },
  {
    title: '关于紫灵',
    items: [
      { title: '关于紫灵', subtitle: '了解紫灵 AI', icon: 'info', placeholder: true },
      { title: '服务条款与隐私政策', subtitle: '查看相关条款', icon: 'shield', placeholder: true },
    ],
  },
];

export function getSessionStatus(status: AuthStatus): { label: string; tone: StatusBadgeTone } {
  switch (status) {
    case 'authenticated': return { label: '已连接', tone: 'success' };
    case 'expired': return { label: '已过期', tone: 'danger' };
    case 'error': return { label: '连接异常', tone: 'warning' };
    case 'bootstrapping': return { label: '连接中', tone: 'info' };
    default: return { label: '未连接', tone: 'neutral' };
  }
}
