# Pomofree

有料ポモドーロアプリが課金機能にしがちな要素を、すべて無料で使えるようにしたポモドーロタイマーです。

- タイマーの長さ・休憩間隔は完全に自由にカスタマイズ可能(多くのアプリは有料)
- タスク・プロジェクトの数に上限なし
- セッション履歴と統計・グラフを無制限に閲覧可能
- 環境音(雨・森・カフェ・ホワイトノイズ・波音)をすべて利用可能。すべてWeb Audio APIでその場合成しており、外部音源・広告は一切なし
- テーマ(ライト/ダーク/システム連動)
- データのJSON/CSVエクスポート
- キーボードショートカット
- 任意でSupabaseによる端末間アカウント同期(未設定でもアプリは完全にローカルで動作)

ログイン不要・アカウント登録不要で今すぐ使えます。同期したい場合のみ、下記の手順でSupabaseを設定してください。

## 技術構成

- [Astro](https://astro.build/) (`output: "static"`) + [React](https://react.dev/)(`client:load`で1つだけアイランド化し、タブ切り替えはReact側のstateで行うためタイマーがページ遷移で止まらない)
- [Tailwind CSS v4](https://tailwindcss.com/)
- データはlocalStorageにフレームワーク非依存の形で保存(`src/app/lib/storage.ts`)
- 任意で[Supabase](https://supabase.com/)による同期(未設定なら黙って無効化)
- GitHub Actionsで[GitHub Pages](https://pages.github.com/)に自動デプロイ

## ローカル開発

```bash
npm install
npm run dev
```

`http://localhost:4321/Pomofree/` で確認できます(`astro.config.mjs`の`base`設定により`/Pomofree`配下になります)。

```bash
npm run build    # dist/ に静的ファイルを生成
npm run preview  # ビルド結果をローカルで確認
```

## デプロイ手順(GitHub Pages)

このリポジトリを自分のGitHubアカウントにpushし、GitHub Actionsで自動ビルド・デプロイする構成です。

### 1. リポジトリを作成してpush

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M master
git remote add origin https://github.com/<あなたのGitHubユーザー名>/Pomofree.git
git push -u origin master
```

> このプロジェクトはデフォルトブランチを`master`前提にしています(`main`にしたい場合は`.github/workflows/deploy.yml`の`on.push.branches`も合わせて変更してください)。

### 2. GitHub PagesをActions経由に設定

GitHubのリポジトリ画面で **Settings → Pages** を開き、「Build and deployment」の「Source」を **GitHub Actions** に設定してください。

### 3. github-pages環境でmasterからのデプロイを許可する

GitHub Pagesのデプロイは既定では保護されたブランチからのみ許可されるため、`master`をデフォルトブランチとして使う場合は明示的な許可設定が必要です。

1. **Settings → Environments** を開き、`github-pages`環境を選択(初回のワークフロー実行後に自動生成されます。まだ無ければ手順1のpush後にActionsタブを一度確認してください)
2. **Deployment branches and tags** で `Selected branches and tags` になっていることを確認し、`master` を追加

これを設定しないと、Actionsのログに `Branch "master" is not allowed to deploy to github-pages due to environment protection rules.` というエラーが出てデプロイが失敗します。

### 4. (任意)Supabaseで端末間アカウント同期を有効にする

同期機能を使わない場合はこの手順は不要です。アプリは常にlocalStorageだけで完全に動作します。

1. [supabase.com](https://supabase.com/) で無料プロジェクトを作成
2. プロジェクトのSQL Editorを開き、`supabase-schema.sql` の内容を貼り付けて実行(`user_data`テーブルとRLSポリシーが作成されます)
3. プロジェクトの **Settings → API** から **Project URL** と **anon / public key** を控える
4. GitHubリポジトリの **Settings → Secrets and variables → Actions** で、Secretsとして以下の2つを登録:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
5. 再度pushするか、Actionsタブから手動でワークフローを実行(`workflow_dispatch`)するとビルドに反映されます

ローカル開発で同期を試したい場合は、`.env.example` を `.env` にコピーして同じ2つの値を設定してください(`.env`は`.gitignore`済みでコミットされません)。

同期はメールのマジックリンクのみでログインし、パスワードは扱いません。初回サインイン時、サーバー側に既存データがあればそちらを優先して取得し、なければ端末側のデータをアップロードします。以降は端末側の変更を数秒おきに自動でサーバーへ反映します。複数端末で同時に未同期のデータを溜めてから初めてサインインする場合、後からサインインした端末のデータで上書きされる点にご注意ください(詳細な競合解消は行わない、シンプルな最終更新優先方式です)。

## ディレクトリ構成(抜粋)

```
src/
  app/
    PomofreeApp.tsx       ルートのReactアイランド(タブ切り替え)
    views/                タイマー・タスク・統計・設定の各画面
    lib/                  タイマーエンジン・ストレージ・同期・エクスポート等のロジック
  layouts/Layout.astro    共通レイアウト(テーマのちらつき防止スクリプト含む)
  pages/
    index.astro           ランディングページ
    app.astro             アプリ本体のマウント先
supabase-schema.sql        Supabase同期を使う場合のテーブル定義(任意)
```
