import type { LocaleShape } from "../index";
import type { en } from "./en";

export const ja = {
  common: {
    cancel: "キャンセル",
  },

  order: {
    prefix: "適用順序：",
    file: "このファイルの上書き",
    folder: "直近の上位フォルダの上書き",
    global: "グローバル既定",
    separator: " ▶ ",
  },

  layer: {
    global: "グローバル既定",
    file: "このファイルの設定",
    folder: "このフォルダの設定",
  },

  exception: {
    addGlobal: "グローバル拡張子例外を追加",
    addFile: "このファイルの拡張子例外を追加",
    addFolder: "このフォルダの拡張子例外を追加",
    section: {
      title: "例外：以下の拡張子は上記の値を使用しません",
      desc: "例外はカスタマイズしたフィールドだけを書き換え、残りはこの階層に従います。",
    },
    extension: {
      name: "拡張子",
      desc: "添付ファイルの拡張子に一致する正規表現。リストの上から順に、最初に一致したものが有効です。",
      placeholder: "pdf|docx?",
    },
    inherit: "この階層を継承",
    customize: "カスタマイズ",
    inheritValue: "継承：{value}",
    emptyValue: "（空）",
    remove: "この例外を削除",
    rootFolderDesc: "上の「添付ファイルの保存先ルートパス」が「Obsidian の設定をコピー」でない場合のみ使用します。",
  },

  settings: {
    title: "グローバル添付ファイル設定",
    others: "その他の設定",
    rootPath: {
      name: "添付ファイルの保存先ルートパス",
      desc: "添付ファイルのルートパスを選択",
      options: {
        obsidian: "Obsidian の設定をコピー",
        inFolder: "指定したフォルダ内",
        nextToNote: "ノートと同じフォルダ内の指定したサブフォルダ",
      },
    },
    rootFolder: {
      name: "添付ファイルの保存先ルートフォルダ",
      desc: "新しい添付ファイルのルートフォルダ。入力中に Vault 内の既存フォルダが候補として表示されます。",
    },
    attachmentPath: {
      name: "添付ファイルのフォルダ",
      desc: "ルートフォルダ内の添付ファイルのフォルダ。利用可能な変数：${notepath}、${notename}、${parent}",
    },
    attachmentFormat: {
      name: "添付ファイル名",
      desc: "添付ファイルの名前の付け方を定義します。利用可能な変数：${date}、${notename}、${md5}、${originalname}。",
    },
    dateFormat: {
      name: "日付フォーマット",
      desc: "使用する Moment.js の日付フォーマット",
      linkText: "Moment.js のフォーマットオプション",
    },
    autoRename: {
      name: "添付ファイルを自動でリネーム",
      desc: "対応する md/canvas ファイルが置かれているフォルダ/ファイルの名前を変更すると、添付ファイルのフォルダ/ファイル名も自動的に変更されます。",
    },
    excludeExtension: {
      name: "添付ファイルに含めない拡張子",
      desc: "指定した拡張子は添付ファイルとして扱いません。先頭のドットを除いた拡張子に正規表現でマッチします。",
      placeholder: "pdf|docx?|xlsx?|pptx?|zip|rar",
    },
    excludedPaths: {
      name: "管理対象外のノートフォルダ",
      desc: "これらのフォルダにあるノートは添付ファイル管理の対象外となります。フルパスの一覧を指定してください（大文字と小文字を区別し、先頭にスラッシュ「/」を付けないでください）。区切りはセミコロン（;）です。",
    },
    excludeSubpaths: {
      name: "サブフォルダも同様",
      desc: "上記フォルダのサブフォルダにも適用されます。",
    },
    diagnostics: {
      name: "診断",
      enable: {
        name: "診断ログを書き出す",
        desc: "トラブルシューティング用の診断ログを {path} に書き出します。WARN と ERROR は常に記録され、オンにすると INFO と TRACE も記録されます。プラグインの再読み込みごとにログは log.txt.bak にローテートされ、現在のファイルは消去されます。",
      },
    },
  },

  override: {
    title: "グローバル添付ファイル設定を上書き：{path}",
    menuTitle: "グローバル添付ファイル設定を上書き",
    buttons: {
      reset: "この項目の上書きを削除",
      submit: "確認",
    },
    notifications: {
      reset: "{path} の上書きを削除しました",
      overridden: "{path} のグローバル添付ファイル設定を上書きしました",
    },
  },

  confirm: {
    title: "ヒント",
    message: "この操作は元に戻せず、実験的なものです。最初に Vault をバックアップしてください！本当に続行しますか？",
    continue: "続行",
  },

  notices: {
    fileExcluded: "{path} は除外されました",
    overrideRemoved: "{path} の上書きを削除しました",
    fileRenamed: "{from} から {to} にリネームしました",
    filesRenamedBatch: "{count} 件の添付ファイルをリネームしました",
    arrangeCompleted: "整理が完了しました",
    resetAttachmentSetting: "{path} の上書きを削除しました",
    error: {
      unknownError: "不明なエラーが発生しました",
    },
  },

  commands: {
    rearrangeAllLinks: "リンクされているすべての添付ファイルを再整理",
    rearrangeActiveLinks: "リンクされている添付ファイルを再整理",
    overrideSetting: "グローバル添付ファイル設定を上書き",
    resetOverrideSetting: "この項目の上書きを削除：{path}",
    clearUnusedStorage: "未使用の元のファイル名ストレージをクリア",
  },

  errors: {
    canvasNotSupported: "Canvas は拡張子例外としてサポートされていません。",
    markdownNotSupported: "Markdown は拡張子例外としてサポートされていません。",
    extensionEmpty: "拡張子例外は空にできません。",
    duplicateExtension: "重複した拡張子例外。",
    excludedExtension: "拡張子例外は、除外された拡張子にできません。",
    attachFormatEmpty: "添付ファイル名を空にできません。",
    attachFormatIllegalChar: "添付ファイル名に不正なファイル名文字が含まれています：{char}",
    attachFormatUnknownVariable: "添付ファイル名内の未知の変数：{name}",
    attachmentPathEmpty: "添付ファイルのフォルダを空にできません。",
    attachmentPathIllegalChar: "添付ファイルのフォルダに不正なファイル名文字が含まれています：{char}",
    attachmentPathUnknownVariable: "添付ファイルのフォルダ内の未知の変数：{name}",
  },
} as const satisfies LocaleShape<typeof en>;
