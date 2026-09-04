import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';

const currentTimeParameters = Type.Object({});

type CurrentTimeDetails = {
  time: string;
};

export const getCurrentTimeTool: AgentTool<
  typeof currentTimeParameters,
  CurrentTimeDetails
> = {
  name: 'get_current_time',
  label: '获取当前时间',
  description: '获取服务器当前的 ISO 8601 格式时间。',
  parameters: currentTimeParameters,
  execute: async () => {
    const time = new Date().toISOString();
    return {
      content: [{ type: 'text', text: JSON.stringify({ time }) }],
      details: { time },
    };
  },
};
