export type ConfirmVariant = 'warning' | 'danger';

export interface ConfirmCopyEntry {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: ConfirmVariant;
}

export type ConfirmExecutor = () => void | Promise<void>;

export type ConfirmActionId =
  | 'nav_step_switch'
  | 'nav_prev_step'
  | 'nav_next_step'
  | 'framework_ai_suggest'
  | 'framework_generate_content'
  | 'framework_add_chapter'
  | 'framework_add_subslide'
  | 'framework_delete_chapter'
  | 'framework_delete_subslide'
  | 'framework_reset_preset'
  | 'image_bulk_import'
  | 'image_upload'
  | 'image_replace'
  | 'image_remove'
  | 'generate_build_pptx'
  | 'generate_download_pptx'
  | 'content_generate_start'
  | 'task_reset_all';

export interface ConfirmPayloadMap {
  nav_step_switch: {
    fromStepLabel: string;
    toStepLabel: string;
  };
  nav_prev_step: {
    fromStepLabel: string;
    toStepLabel: string;
  };
  nav_next_step: {
    fromStepLabel: string;
    toStepLabel: string;
  };
  framework_ai_suggest: {
    chapterCount: number;
  };
  framework_generate_content: {
    totalPages: number;
  };
  framework_add_chapter: {
    nextChapterIndex: number;
  };
  framework_add_subslide: {
    chapterTitle: string;
    nextSubslideIndex: number;
  };
  framework_delete_chapter: {
    chapterTitle: string;
  };
  framework_delete_subslide: {
    chapterTitle: string;
    subtitle: string;
  };
  framework_reset_preset: {
    presetName: string;
  };
  image_bulk_import: {
    fileCount: number;
    availableSlots: number;
  };
  image_upload: {
    page: number;
    slotIndex: number;
    fileName: string;
  };
  image_replace: {
    page: number;
    slotIndex: number;
    fileName: string;
  };
  image_remove: {
    page: number;
    slotIndex: number;
  };
  generate_build_pptx: {
    totalSlides: number;
    riskSummary: string;
  };
  generate_download_pptx: {
    fileName: string;
  };
  content_generate_start: {
    chapterCount: number;
  };
  task_reset_all: {
    currentStepLabel: string;
  };
}

type ConfirmCopyRegistry = {
  [K in ConfirmActionId]: (payload: ConfirmPayloadMap[K]) => ConfirmCopyEntry;
};

const confirmCopyRegistry: ConfirmCopyRegistry = {
  nav_step_switch: ({ fromStepLabel, toStepLabel }) => ({
    title: '确认切换步骤？',
    message: `即将从“${fromStepLabel}”跳转到“${toStepLabel}”。`,
    confirmText: '确认切换',
    cancelText: '留在当前步骤',
    variant: 'warning',
  }),
  nav_prev_step: ({ fromStepLabel, toStepLabel }) => ({
    title: '确认返回上一步？',
    message: `即将从“${fromStepLabel}”返回到“${toStepLabel}”。`,
    confirmText: '返回上一步',
    cancelText: '取消',
    variant: 'warning',
  }),
  nav_next_step: ({ fromStepLabel, toStepLabel }) => ({
    title: '确认进入下一步？',
    message: `即将从“${fromStepLabel}”进入“${toStepLabel}”。`,
    confirmText: '进入下一步',
    cancelText: '取消',
    variant: 'warning',
  }),
  framework_ai_suggest: ({ chapterCount }) => ({
    title: '确认执行 AI 建议调整？',
    message: `将基于当前 ${chapterCount} 个章节重新分析并更新建议内容。`,
    confirmText: '开始分析',
    cancelText: '取消',
    variant: 'warning',
  }),
  framework_generate_content: ({ totalPages }) => ({
    title: '确认开始生成内容？',
    message: `将按当前框架生成约 ${totalPages} 页内容，过程可能持续数十秒。`,
    confirmText: '开始生成',
    cancelText: '再检查一下',
    variant: 'warning',
  }),
  framework_add_chapter: ({ nextChapterIndex }) => ({
    title: '确认添加章节？',
    message: `将新增第 ${nextChapterIndex} 章，并默认附带 1 个子章节。`,
    confirmText: '确认添加',
    cancelText: '取消',
    variant: 'warning',
  }),
  framework_add_subslide: ({ chapterTitle, nextSubslideIndex }) => ({
    title: '确认添加子章节？',
    message: `将在“${chapterTitle || '未命名章节'}”下新增第 ${nextSubslideIndex} 个子章节。`,
    confirmText: '确认添加',
    cancelText: '取消',
    variant: 'warning',
  }),
  framework_delete_chapter: ({ chapterTitle }) => ({
    title: '确认删除章节？',
    message: `将删除章节“${chapterTitle || '未命名章节'}”及其全部子章节。`,
    confirmText: '确认删除',
    cancelText: '取消',
    variant: 'danger',
  }),
  framework_delete_subslide: ({ chapterTitle, subtitle }) => ({
    title: '确认删除子章节？',
    message: `将从“${chapterTitle || '未命名章节'}”中删除子章节“${subtitle || '未命名子章节'}”。`,
    confirmText: '确认删除',
    cancelText: '取消',
    variant: 'danger',
  }),
  framework_reset_preset: ({ presetName }) => ({
    title: '确认重置默认？',
    message: `将按“${presetName}”模板重置章节结构，当前未保存的手动调整会丢失。`,
    confirmText: '确认重置',
    cancelText: '取消',
    variant: 'danger',
  }),
  image_bulk_import: ({ fileCount, availableSlots }) => ({
    title: '确认批量导入图片？',
    message: `准备导入 ${fileCount} 张图片，当前可填充槽位 ${availableSlots} 个。`,
    confirmText: '确认导入',
    cancelText: '取消',
    variant: 'warning',
  }),
  image_upload: ({ page, slotIndex, fileName }) => ({
    title: '确认上传图片？',
    message: `将上传“${fileName}”到第 ${page} 页第 ${slotIndex} 个图片槽位。`,
    confirmText: '确认上传',
    cancelText: '取消',
    variant: 'warning',
  }),
  image_replace: ({ page, slotIndex, fileName }) => ({
    title: '确认替换图片？',
    message: `将用“${fileName}”替换第 ${page} 页第 ${slotIndex} 个图片槽位的现有图片。`,
    confirmText: '确认替换',
    cancelText: '取消',
    variant: 'warning',
  }),
  image_remove: ({ page, slotIndex }) => ({
    title: '确认移除图片？',
    message: `将移除第 ${page} 页第 ${slotIndex} 个图片槽位中的图片。`,
    confirmText: '确认移除',
    cancelText: '取消',
    variant: 'danger',
  }),
  generate_build_pptx: ({ totalSlides, riskSummary }) => ({
    title: '确认生成 PPTX？',
    message: `将基于当前 ${totalSlides} 页内容生成 PPTX。风险提示：${riskSummary}`,
    confirmText: '确认生成',
    cancelText: '返回检查',
    variant: 'warning',
  }),
  generate_download_pptx: ({ fileName }) => ({
    title: '确认下载文件？',
    message: `将下载文件“${fileName}”到本地设备。`,
    confirmText: '确认下载',
    cancelText: '取消',
    variant: 'warning',
  }),
  content_generate_start: ({ chapterCount }) => ({
    title: '确认启动内容生成？',
    message: `将根据当前 ${chapterCount} 个章节启动 AI 内容生成任务。`,
    confirmText: '确认启动',
    cancelText: '取消',
    variant: 'warning',
  }),
  task_reset_all: ({ currentStepLabel }) => ({
    title: '确认开始新任务？',
    message: `当前位于“${currentStepLabel}”。确认后将清空文档、框架、导入图片、审计修改与导出结果，并自动返回“上传文档”。`,
    confirmText: '确认清空并开始',
    cancelText: '取消',
    variant: 'danger',
  }),
};

export function resolveConfirmCopy<K extends ConfirmActionId>(
  actionId: K,
  payload: ConfirmPayloadMap[K],
): ConfirmCopyEntry {
  return confirmCopyRegistry[actionId](payload);
}

export type ConfirmRequest = <K extends ConfirmActionId>(
  actionId: K,
  payload: ConfirmPayloadMap[K],
  executor: ConfirmExecutor,
) => void;
