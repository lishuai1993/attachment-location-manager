import type { LocaleShape } from "../index";
import type { en } from "./en";

export const zhCn = {
  common: {
    cancel: "取消",
  },

  order: {
    prefix: "适用顺序：",
    file: "本文件覆盖",
    folder: "最近上层文件夹覆盖",
    global: "全局默认",
    separator: " ▶ ",
  },

  layer: {
    global: "全局默认",
    file: "本文件的四项",
    folder: "本文件夹的四项",
  },

  exception: {
    addGlobal: "添加全局特例",
    addFile: "添加本文件特例",
    addFolder: "添加本文件夹特例",
    section: {
      title: "特例：下列扩展名单独取值，不适用上面的值",
      desc: "特例不豁免任何规则，只改写被自定义的字段，其余跟随本层。",
    },
    extension: {
      name: "扩展名",
      desc: "正则匹配附件的扩展名，不区分大小写，列表自上而下首个命中生效。",
      placeholder: "pdf|docx?",
    },
    inherit: "继承本层",
    customize: "自定义",
    inheritValue: "继承：{value}",
    emptyValue: "（空）",
    remove: "删除本特例",
    rootFolderDesc: "仅当上面的「附件保存根路径」不是「复制 Obsidian 设置」时使用。",
  },

  settings: {
    title: "全局附件设置",
    others: "其它设置",
    rootPath: {
      name: "附件保存根路径",
      desc: "选择附件的根路径",
      options: {
        obsidian: "复制 Obsidian 设置",
        inFolder: "在下方指定的文件夹中",
        nextToNote: "在笔记旁边的指定文件夹中",
      },
    },
    rootFolder: {
      name: "附件保存根文件夹",
      desc: "新附件的根文件夹。输入时会提示仓库内已有的文件夹。",
    },
    attachmentPath: {
      name: "附件文件夹",
      desc: "附件在根文件夹中的文件夹，可用变量 ${notepath}、${notename}、${parent}",
    },
    attachmentFormat: {
      name: "附件名称",
      desc: "定义如何命名附件文件，可用变量 ${date}、${notename}、${md5} 和 ${originalname}。",
    },
    dateFormat: {
      name: "日期格式",
      desc: "使用的 Moment 日期格式",
      linkText: "Moment 格式选项",
    },
    autoRename: {
      name: "自动重命名附件",
      desc: "当您重命名对应 md/canvas 文件所在的文件夹/文件名时，自动重命名附件文件夹/文件名。",
    },
    excludeExtension: {
      name: "不计为附件的扩展名",
      desc: "将指定扩展名排除在附件范围之外，正则匹配不带点的扩展名，不区分大小写。留空时，所有非笔记文件都被当作附件。",
      placeholder: "pdf|docx?|xlsx?|pptx?|zip|rar",
    },
    excludedPaths: {
      name: "不管理的笔记目录",
      desc: "这些目录下的笔记不参与附件管理，填写完整路径列表（区分大小写、不带前导斜杠 '/'），用分号（;）分隔。",
    },
    excludeSubpaths: {
      name: "子目录同此",
      desc: "上述目录的子目录一并适用。",
    },
    overrideList: {
      name: "覆盖清单",
      empty: "尚无覆盖项。右键文件或文件夹，选择「覆盖全局附件设置」即可新增。",
      typeFile: "文件覆盖",
      typeFolder: "文件夹覆盖",
      kindFile: "文件",
      kindFolder: "文件夹",
      overview: "概况：{type}，",
      valueEmpty: "（空）",
      fieldMode: "取根方式：{value}",
      fieldRoot: "根路径：{value}",
      fieldPath: "附件文件夹：{value}",
      fieldFormat: "命名：{value}",
      statusOk: "目标存在",
      statusMissing: "目标已不存在——该覆盖已失效",
      statusMismatch: "但该路径下现在是{actual}——该覆盖已失效",
      remove: "移除该覆盖",
    },
    diagnostics: {
      name: "诊断",
      enable: {
        name: "写入诊断日志",
        desc: "将诊断日志写入 {path} 以便排查问题。WARN 与 ERROR 始终记录；开启后还会记录 INFO 与 TRACE。插件每次重载都会将日志轮转为 log.txt.bak 并清空当前文件。",
      },
    },
  },

  override: {
    title: "覆盖全局附件设置：{path}",
    menuTitle: "覆盖全局附件设置",
    buttons: {
      reset: "移除本条目覆盖",
      submit: "确认",
    },
    notifications: {
      reset: "已移除 {path} 的覆盖",
      overridden: "已为 {path} 覆盖全局附件设置",
    },
  },

  confirm: {
    title: "提示",
    message: "此操作不可逆且为实验性功能，请先备份您的库！确定要继续吗？",
    continue: "继续",
  },

  notices: {
    fileExcluded: "{path} 已被排除",
    overrideRemoved: "已移除 {path} 的覆盖",
    fileRenamed: "已将 {from} 重命名为 {to}",
    filesRenamedBatch: "已重命名 {count} 个附件",
    arrangeNothingFound: "没有需要整理的附件",
    arrangeSummary: "整理完成：移动 {moved}，复制 {copied}，跳过 {skipped}，失败 {failed}",
    noActiveNote: "请先打开一篇笔记或 canvas",
    resetAttachmentSetting: "已移除 {path} 的覆盖",
    error: {
      unknownError: "发生未知错误",
    },
  },

  commands: {
    rearrangeAllLinks: "重新整理所有链接的附件",
    rearrangeActiveLinks: "重新整理链接的附件",
    overrideSetting: "覆盖全局附件设置",
    resetOverrideSetting: "移除本条目覆盖：{path}",
    clearUnusedStorage: "清理未使用的原始文件名存储",
  },

  errors: {
    canvasNotSupported: "不支持把 Canvas 作为特例。",
    markdownNotSupported: "不支持把 Markdown 作为特例。",
    extensionEmpty: "特例的扩展名不能为空。",
    duplicateExtension: "已存在同扩展名的特例。",
    excludedExtension: "该扩展名已被「不计为附件的扩展名」排除，不能作为特例。",
    exceptionRejected: "有特例卡片的扩展名未通过校验，请改成合法值或删除该卡片。",
    attachFormatEmpty: "附件名称不能为空。",
    attachFormatIllegalChar: "附件名称包含非法文件名字符：{char}",
    attachFormatUnknownVariable: "附件名称中存在未知变量：{name}",
    attachmentPathEmpty: "附件文件夹不能为空。",
    attachmentPathIllegalChar: "附件文件夹包含非法文件名字符：{char}",
    attachmentPathUnknownVariable: "附件文件夹中存在未知变量：{name}",
  },
} as const satisfies LocaleShape<typeof en>;
