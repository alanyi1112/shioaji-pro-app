import { X } from 'lucide-react';
import { useState } from 'react';
import { openMultiViewWindow } from '../lib/multiview-window';
import { LAYOUT_PRESETS } from '../lib/workspace';
import { Menu } from './header-menu';
import * as styles from './hud-header.css';

export function ProfilesMenu({
    profiles,
    onSaveProfile,
    onLoadProfile,
    onDeleteProfile,
    onResetWorkspace,
    onLoadPreset,
}: {
    profiles: string[];
    onSaveProfile: (name: string) => void;
    onLoadProfile: (name: string) => void;
    onDeleteProfile: (name: string) => void;
    onResetWorkspace: () => void;
    onLoadPreset: (name: string) => void;
}) {
    const [name, setName] = useState('');
    const normalizedName = name.trim();
    const updatesExisting = profiles.includes(normalizedName);
    const submitProfile = () => {
        if (!normalizedName) return;
        onSaveProfile(normalizedName);
        setName('');
    };

    return (
        <Menu label='版面'>
            {(close) => (
                <>
                    <span className={styles.settingLabel}>多圖看盤</span>
                    <button
                        className={styles.menuItem}
                        title='在新分頁開啟本機 MultiView，不變更目前版面'
                        onClick={() => {
                            const opened = openMultiViewWindow();
                            close();
                            if (!opened) {
                                window.alert(
                                    '瀏覽器已阻擋 MultiView 新分頁，請允許彈出視窗後重試。',
                                );
                            }
                        }}
                    >
                        MultiView（開新分頁）
                        <span className={styles.presetDesc}>
                            1／2／3／4／6／8 圖看盤
                        </span>
                    </button>
                    <span className={styles.settingLabel}>
                        儲存目前版面 Save Layout
                    </span>
                    <div className={styles.saveRow}>
                        <input
                            className={styles.saveInput}
                            placeholder='版面名稱'
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') submitProfile();
                            }}
                        />
                        <button
                            className={styles.resetBtn}
                            disabled={!normalizedName}
                            onClick={submitProfile}
                        >
                            {updatesExisting ? '更新' : '另存'}
                        </button>
                    </div>
                    <span className={styles.saveHint} role='status'>
                        {!normalizedName
                            ? '輸入名稱以另存目前版面'
                            : updatesExisting
                              ? `將更新並覆寫同名版面「${normalizedName}」`
                              : `將另存為新具名版面「${normalizedName}」`}
                    </span>
                    <span className={styles.settingLabel}>
                        版面列表 Saved Layouts
                    </span>
                    {profiles.length === 0 && (
                        <span className={styles.emptyHint}>
                            尚無儲存的版面
                        </span>
                    )}
                    {profiles.map((profile) => (
                        <div key={profile} className={styles.profileRow}>
                            <button
                                className={styles.menuItem}
                                style={{ flex: 1 }}
                                onClick={() => {
                                    onLoadProfile(profile);
                                    close();
                                }}
                            >
                                {profile}
                            </button>
                            <button
                                className={styles.profileDelete}
                                title='刪除此版面'
                                onClick={() => onDeleteProfile(profile)}
                            >
                                <X size={10} />
                            </button>
                        </div>
                    ))}
                    <span className={styles.settingLabel}>
                        預設版面 Presets
                    </span>
                    {LAYOUT_PRESETS.map((preset) => (
                        <button
                            key={preset.name}
                            className={styles.menuItem}
                            title={preset.desc}
                            onClick={() => {
                                onLoadPreset(preset.name);
                                close();
                            }}
                        >
                            {preset.name}
                            <span className={styles.presetDesc}>
                                {preset.desc}
                            </span>
                        </button>
                    ))}
                    <button
                        className={styles.menuItem}
                        onClick={() => {
                            onResetWorkspace();
                            close();
                        }}
                    >
                        ↺ 重設為預設版面
                    </button>
                </>
            )}
        </Menu>
    );
}
