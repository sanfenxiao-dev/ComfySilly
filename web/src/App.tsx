import { normalizeSettings, preferencesOf, personaOf, applyPreferences } from './types/settings';
import type { Preferences } from './types/settings';
import type { SettingsSection } from './components/SettingsModal';
import { CharacterWrites } from './utils/characterWrites';
import { validateWorkflow } from './utils/workflowValidation';
import { connectPromptOrder, appendRegexRules, orderedRegexNodes } from './utils/canvasState';
import { RegexImportDialog, RegexNodeActions } from './components/RegexImportDialog';
import { ConfirmDialog } from './components/Dialog';
import { compilePrompt } from './utils/promptCompiler';
import { orderPrompts, withPromptOrder } from './utils/promptCompiler';
import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { HeaderTabs } from './components/HeaderTabs';
import { PresetSidebar } from './components/PresetSidebar';
import { PromptFloatingWindow } from './components/PromptFloatingWindow';
import { CanvasContextMenu } from './components/CanvasContextMenu';
import { SettingsModal, type AppSettings } from './components/SettingsModal';
import { CharacterShelf, type CharacterCardData } from './components/CharacterShelf';
import { CharacterDetail } from './components/CharacterDetail';
const ChatRoom = lazy(() => import('./components/ChatRoom').then((m) => ({ default: m.ChatRoom })));
import { LorebookModal, type LorebookData } from './components/LorebookModal';
import { WorldbookView, type GlobalWorldbookMeta } from './components/WorldbookView';
import {
  PromptBlockNode,
  LorebookNode,
  HistorySamplerNode,
  AssemblerNode,
  LlmInferenceNode,
  RegexFilterNode,
} from './components/nodes/CustomNodes';
import {
  convertSillyPresetToGraph,
  exportGraphToSillyPreset,
  type SillyPresetJson,
  type SillyPromptItem,
} from './utils/presetImporter';
import type { TabType } from './types/flow';
import { Sparkles, Layers, X, ShieldCheck, Code, Workflow, MessageSquare } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface PresetItemMeta {
  name: string;
  path: string;
  modified_time: number;
}

function FlowWorkspace() {
  const [workflowPreview, setWorkflowPreview] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<TabType>('preset');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [allPromptsList, setAllPromptsList] = useState<SillyPromptItem[]>([]);
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [statusMessage, setStatusMessage] = useState<string>(
    '就绪 - 支持角色卡书架典藏、AI多提供商设置、预设绑定正则',
  );
  const firstStatus = useRef(true);
  useEffect(() => {
    if (firstStatus.current) {
      firstStatus.current = false;
      return;
    }
    setToast(statusMessage);
    const timer = setTimeout(
      () => setToast(''),
      /失败|错误|未保存/.test(statusMessage) ? 15000 : 6500,
    );
    return () => clearTimeout(timer);
  }, [statusMessage]);
  const [currentPresetName, setCurrentPresetName] = useState<string>('默认预设');
  const [presetList, setPresetList] = useState<PresetItemMeta[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
    edgeId?: string;
  } | null>(null);

  // 全局设置 Modal 状态
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('models');
  const [previewPreferences, setPreviewPreferences] = useState<Preferences | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [appSettings, setAppSettings] = useState<AppSettings | undefined>();
  useEffect(() => {
    applyPreferences(previewPreferences ?? preferencesOf(appSettings));
  }, [appSettings, previewPreferences]);

  // 角色卡典藏馆与对话状态
  const characterWrites = useRef(
    new CharacterWrites<CharacterCardData>(async (value) => {
      await invoke('save_character_to_library', {
        id: value.id,
        payloadJson: JSON.stringify(value),
      });
    }),
  );
  const [characters, setCharacters] = useState<CharacterCardData[]>([]);
  const [detailCharacter, setDetailCharacter] = useState<CharacterCardData | null>(null);
  const [chatCharacter, setChatCharacter] = useState<CharacterCardData | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | undefined>();
  const [lorebookModalState, setLorebookModalState] = useState<{
    isOpen: boolean;
    title: string;
    data: LorebookData;
    onSaveCallback: (updated: LorebookData) => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    data: { name: '', entries: [] },
    onSaveCallback: () => {},
  });
  const [globalWorldbooks, setGlobalWorldbooks] = useState<GlobalWorldbookMeta[]>([]);

  const basePresetRef = useRef<SillyPresetJson | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [regexImportTarget, setRegexImportTarget] = useState<string | null>(null);
  const [pendingCanvasDelete, setPendingCanvasDelete] = useState<{
    nodes: Node[];
    edges: Edge[];
  } | null>(null);
  const [canvasUndo, setCanvasUndo] = useState<{
    nodes: Node[];
    edges: Edge[];
    prompts: SillyPromptItem[];
  } | null>(null);
  const graphRef = useRef({ nodes, edges });
  graphRef.current = { nodes, edges };
  // Selection, measurement and pointer movement are not prompt edits. Keep a
  // semantic snapshot stable so dragging hundreds of nodes never serializes
  // the complete preset or invalidates chat regex/compilation caches.
  const semanticRef = useRef({ nodes, edges });
  if (
    nodes.length !== semanticRef.current.nodes.length ||
    nodes.some((n, i) => {
      const old = semanticRef.current.nodes[i];
      return n.id !== old.id || n.type !== old.type || n.data !== old.data;
    })
  )
    semanticRef.current.nodes = nodes;
  if (
    edges.length !== semanticRef.current.edges.length ||
    edges.some((e, i) => {
      const old = semanticRef.current.edges[i];
      return (
        e.id !== old.id ||
        e.source !== old.source ||
        e.target !== old.target ||
        e.sourceHandle !== old.sourceHandle ||
        e.targetHandle !== old.targetHandle
      );
    })
  )
    semanticRef.current.edges = edges;
  const semanticNodes = semanticRef.current.nodes,
    semanticEdges = semanticRef.current.edges;
  const regexOrder = useMemo(
    () => orderedRegexNodes(semanticNodes, semanticEdges).map((n) => n.id),
    [semanticNodes, semanticEdges],
  );
  const regexActions = useMemo(
    () => ({ onImport: setRegexImportTarget, order: regexOrder }),
    [regexOrder],
  );
  const activePreset = useMemo(
    () =>
      exportGraphToSillyPreset(
        allPromptsList,
        semanticNodes,
        basePresetRef.current ?? undefined,
        semanticEdges,
      ),
    [allPromptsList, semanticNodes, semanticEdges],
  );
  useEffect(() => {
    basePresetRef.current = activePreset;
  }, [activePreset]);
  const { setCenter, screenToFlowPosition } = useReactFlow();

  const refreshPresetLibrary = useCallback(async () => {
    try {
      const list = await invoke<PresetItemMeta[]>('list_preset_library');
      setPresetList(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // 刷新角色卡书架列表
  const refreshWorldbookLibrary = useCallback(async () => {
    try {
      const rawList = await invoke<Array<{ name: string; path: string }>>('list_worldbook_library');
      const metas: GlobalWorldbookMeta[] = [];
      for (const item of rawList) {
        try {
          const content = await invoke<string>('load_preset_file', { filePath: item.path });
          const parsed = JSON.parse(content);
          const rawEntries = parsed.entries || parsed;
          const entries = Array.isArray(rawEntries)
            ? rawEntries
            : typeof rawEntries === 'object'
              ? Object.values(rawEntries)
              : [];
          metas.push({
            name: parsed.name || item.name,
            storageName: item.name,
            path: item.path,
            entriesCount: entries.length,
            enabled:
              JSON.parse(localStorage.getItem('comfysilly:worldbook-switches') || '{}')[
                item.path
              ] !== false,
            data: {
              ...parsed,
              name: parsed.name || item.name,
              entries,
            },
          });
        } catch {
          // ignore
        }
      }
      setGlobalWorldbooks(metas);
      return metas;
    } catch {
      return [];
    }
  }, []);

  const handleImportWorldbook = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SillyTavern WorldBook JSON', extensions: ['json'] }],
        title: '请选择酒馆世界书 JSON 文件',
      });
      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : selected[0];
      setStatusMessage(`正在读取世界书: ${filePath}...`);
      const fileContent = await invoke<string>('load_preset_file', { filePath });
      const fileName = (filePath.split('\\').pop() || 'WorldBook').replace('.json', '');
      await invoke('save_worldbook_to_library', {
        name: fileName,
        content: fileContent,
      });
      await refreshWorldbookLibrary();
      setStatusMessage(`世界书《${fileName}》已成功导入并持久化入库！`);
    } catch (err: any) {
      setStatusMessage(`导入世界书失败: ${err?.message}`);
    }
  };

  const handleNewWorldbook = async () => {
    const newName = `New-Lorebook-${Date.now().toString().slice(-4)}`;
    const blankData = {
      name: newName,
      entries: [
        {
          uid: 0,
          comment: '世界观总览',
          key: ['世界', '大陆'],
          content: '请在此填写世界观全局设定...',
          constant: true,
          selective: false,
          depth: 4,
          order: 100,
        },
      ],
    };
    await invoke('save_worldbook_to_library', {
      name: newName,
      content: JSON.stringify(blankData, null, 2),
    });
    await refreshWorldbookLibrary();
    setStatusMessage(`已新建空白世界书《${newName}》！`);
  };

  const handleDeleteWorldbook = async (name: string, path: string) => {
    try {
      await invoke('delete_worldbook_from_library', { path });
      setStatusMessage(`已删除世界书《${name}》`);
      await refreshWorldbookLibrary();
    } catch (err: any) {
      setStatusMessage(`删除失败: ${String(err)}`);
      throw err;
    }
  };

  const handleToggleWorldbook = (path: string, enabled: boolean) => {
    const name = globalWorldbooks.find((b) => b.path === path)?.name ?? '世界书';
    const switches = JSON.parse(localStorage.getItem('comfysilly:worldbook-switches') || '{}');
    switches[path] = enabled;
    localStorage.setItem('comfysilly:worldbook-switches', JSON.stringify(switches));
    setGlobalWorldbooks((prev) => prev.map((wb) => (wb.path === path ? { ...wb, enabled } : wb)));
    setStatusMessage(`世界书《${name}》已${enabled ? '启用全局监听' : '已停用'}`);
  };

  const handleOpenGlobalWorldbookEditor = (wb: GlobalWorldbookMeta) => {
    setLorebookModalState({
      isOpen: true,
      title: `全局世界书编辑 - 《${wb.name}》`,
      data: wb.data,
      onSaveCallback: async (updated) => {
        await invoke('save_worldbook_to_library', {
          name: wb.storageName ?? wb.name,
          content: JSON.stringify(updated, null, 2),
        });
        await refreshWorldbookLibrary();
        setStatusMessage(`世界书《${wb.name}》已更新保存！`);
      },
    });
  };

  const handlePatchCharacter = async (
    base: CharacterCardData,
    patch: Partial<CharacterCardData>,
  ) => {
    const updated = await characterWrites.current.save(base, patch);
    setDetailCharacter((current) => (current?.id === updated.id ? updated : current));
    setChatCharacter((current) => (current?.id === updated.id ? updated : current));
    setCharacters((current) => current.map((c) => (c.id === updated.id ? updated : c)));
    return updated;
  };
  const handleUpdateCharacter = async (updated: CharacterCardData) => {
    // Character editor changes metadata only; session history belongs to the chat writer.
    const { sessions: _sessions, activeSessionId: _active, ...metadata } = updated;
    await handlePatchCharacter(updated, metadata);
    setStatusMessage(`角色卡《${updated.name}》设定已保存！`);
  };

  const handleOpenCharacterLorebook = (char: CharacterCardData) => {
    setLorebookModalState({
      isOpen: true,
      title: `角色专属世界书 - 《${char.name}》`,
      data: char.lorebook || { name: `${char.name}的世界书`, entries: [] },
      onSaveCallback: async (updated) => {
        const updatedChar = {
          ...char,
          lorebook: {
            ...char.lorebook,
            ...updated,
            name: updated.name,
            entries: updated.entries,
          },
        };
        await handlePatchCharacter(char, { lorebook: updatedChar.lorebook });
        setStatusMessage(
          `角色卡《${char.name}》专属世界书已更新（${updated.entries.length} 条）！`,
        );
      },
    });
  };

  const refreshCharacterLibrary = useCallback(async () => {
    try {
      const rawList = await invoke<string[]>('list_character_library');
      const list: CharacterCardData[] = rawList
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      setCharacters(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // 节点开关切换
  const handleNodeToggle = useCallback(
    (id: string, enabled: boolean) => {
      setAllPromptsList((prev) => {
        const updated = prev.map((p, idx) => {
          const nid = `prompt-${p.identifier || idx}`;
          if (nid === id) {
            return { ...p, enabled };
          }
          return p;
        });

        if (basePresetRef.current) {
          const updatedPreset = withPromptOrder(
            exportGraphToSillyPreset(
              updated,
              graphRef.current.nodes,
              basePresetRef.current,
              graphRef.current.edges,
            ),
            updated,
          );
          basePresetRef.current = updatedPreset;
          const { nodes: newNodes, edges: newEdges } = convertSillyPresetToGraph(updatedPreset, {
            onToggle: handleNodeToggle,
            onUpdate: handleNodeUpdate,
          });
          setNodes(newNodes);
          setEdges(newEdges);
        }
        return updated;
      });
    },
    [setNodes, setEdges],
  );

  // 节点参数修改
  const handleNodeUpdate = useCallback(
    (id: string, patch: any) => {
      setNodes((nds) =>
        nds.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)),
      );
      setAllPromptsList((prev) => {
        const updated = prev.map((p, index) =>
          `prompt-${p.identifier || index}` === id
            ? {
                ...p,
                ...patch,
                ...('depth' in patch ? { injection_depth: patch.depth } : {}),
                ...('order' in patch ? { injection_order: patch.order } : {}),
              }
            : p,
        );
        if (basePresetRef.current)
          basePresetRef.current = withPromptOrder(basePresetRef.current, updated);
        return updated;
      });
    },
    [setNodes],
  );

  // 左侧纯拖拽排序
  const handleReorderList = useCallback(
    (draggedId: string, targetId: string) => {
      setAllPromptsList((prev) => {
        const fromIndex = prev.findIndex((p, idx) => `prompt-${p.identifier || idx}` === draggedId);
        const toIndex = prev.findIndex((p, idx) => `prompt-${p.identifier || idx}` === targetId);

        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
          return prev;
        }

        const reordered = [...prev];
        const [movedItem] = reordered.splice(fromIndex, 1);
        reordered.splice(toIndex, 0, movedItem);

        if (basePresetRef.current) {
          const updatedPreset = exportGraphToSillyPreset(
            reordered,
            graphRef.current.nodes,
            basePresetRef.current,
            graphRef.current.edges,
          );
          basePresetRef.current = updatedPreset;
          const { nodes: newNodes, edges: newEdges } = convertSillyPresetToGraph(updatedPreset, {
            onToggle: handleNodeToggle,
            onUpdate: handleNodeUpdate,
          });
          setNodes(newNodes);
          setEdges(newEdges);
        }

        setStatusMessage(`✨ 拖拽调整成功！条目已重新排序`);
        return reordered;
      });
    },
    [setNodes, setEdges, handleNodeToggle, handleNodeUpdate],
  );

  const handleFocusNode = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id);
      if (target) {
        setCenter(target.position.x + 180, target.position.y + 80, {
          zoom: 1.05,
          duration: 600,
        });
      }
    },
    [nodes, setCenter],
  );

  const handleOpenEditor = useCallback(
    (id: string) => {
      setActiveEditorId(id);
      handleFocusNode(id);
    },
    [handleFocusNode],
  );

  const nodeTypes = useMemo(
    () => ({
      promptBlock: PromptBlockNode,
      lorebook: LorebookNode,
      historySampler: HistorySamplerNode,
      assembler: AssemblerNode,
      llmInference: LlmInferenceNode,
      regexFilter: RegexFilterNode,
    }),
    [],
  );

  const onConnect = (params: Connection) => {
    try {
      if (params.source === params.target) throw new Error('不能连接节点自身');
      const source = nodes.find((n) => n.id === params.source),
        target = nodes.find((n) => n.id === params.target);
      if (source?.type === 'promptBlock' && target?.type === 'promptBlock') {
        const ordered = connectPromptOrder(allPromptsList, params.source, params.target);
        setAllPromptsList(ordered);
        setNodes((old) =>
          old.map((n) =>
            n.type === 'promptBlock'
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    calcIndex:
                      ordered
                        .filter((p) => p.enabled !== false)
                        .findIndex((p) => `prompt-${p.identifier}` === n.id) + 1,
                  },
                }
              : n,
          ),
        );
        basePresetRef.current = withPromptOrder(basePresetRef.current ?? {}, ordered);
        const ids = ordered
          .map((p, i) => `prompt-${p.identifier || i}`)
          .filter((id) => nodes.some((n) => n.id === id));
        setEdges((old) => [
          ...old.filter((e) => !(e.source.startsWith('prompt-') && e.target.startsWith('prompt-'))),
          ...ids.slice(1).map((id, i) => ({
            id: `order-${ids[i]}-${id}`,
            source: ids[i],
            target: id,
            sourceHandle: 'prompt_out',
            targetHandle: 'prompt_in',
          })),
        ]);
        setStatusMessage('提示词连线已更新实际条目顺序；深度注入仍遵循各条目的设置');
      } else {
        const next = addEdge({ ...params, style: { stroke: '#a78bfa', strokeWidth: 2 } }, edges);
        validateWorkflow(nodes, next);
        setEdges(next);
        setStatusMessage(
          source?.type === 'regexFilter' && target?.type === 'regexFilter'
            ? '已更新正则实际执行顺序：按节点连线，再按节点内规则顺序执行；请保存预设'
            : '已添加流程连线；正则节点按连线排序，其余通用 DAG 执行尚未接入',
        );
      }
    } catch (e) {
      setStatusMessage(`连线失败：${String(e)}`);
    }
  };

  const loadPresetData = useCallback(
    (presetData: SillyPresetJson, name: string) => {
      try {
        presetData = {
          ...presetData,
          prompts: presetData.prompts?.map((p, i) => ({
            ...p,
            identifier: p.identifier || `comfy-prompt-${i}`,
          })),
        };
        basePresetRef.current = presetData;
        setCanvasUndo(null);
        setPendingCanvasDelete(null);
        setCurrentPresetName(name);
        setAllPromptsList(orderPrompts(presetData));
        localStorage.setItem('comfysilly:last-preset', name);

        const { nodes: newNodes, edges: newEdges } = convertSillyPresetToGraph(presetData, {
          onToggle: handleNodeToggle,
          onUpdate: handleNodeUpdate,
        });
        setNodes(newNodes);
        setEdges(newEdges);
        const regexCount = newNodes
          .filter((n) => n.type === 'regexFilter')
          .reduce((sum, n) => sum + ((n.data.regexList as any[])?.length ?? 0), 0);
        setStatusMessage(`✨ 成功加载「${name}」！识别并接入 ${regexCount} 条预设正则规则！`);
      } catch (err: any) {
        console.error(err);
        setStatusMessage(`❌ 解析失败: ${err?.message || err}`);
      }
    },
    [handleNodeToggle, handleNodeUpdate, setNodes, setEdges],
  );

  const handleNewPreset = useCallback(() => {
    const newName = `New-Preset-${Date.now().toString().slice(-4)}`;
    const blankPreset: SillyPresetJson = {
      temperature: 1.0,
      top_p: 0.95,
      openai_max_tokens: 4096,
      prompts: [
        {
          name: 'Main System Prompt',
          role: 'system',
          content: 'You are a helpful AI assistant.',
          enabled: true,
          injection_depth: 0,
          injection_order: 100,
        },
      ],
    };
    loadPresetData(blankPreset, newName);
    setStatusMessage(`✨ 已新建空白预设工作流「${newName}」！`);
  }, [loadPresetData]);

  const handleDeletePreset = useCallback(
    async (name: string, path: string) => {
      try {
        await invoke('delete_preset_from_library', { path });
        setStatusMessage(`🗑️ 已从预设库成功删除「${name}」！`);
        const updatedList = await refreshPresetLibrary();
        if (currentPresetName === name) {
          if (updatedList.length > 0) {
            const first = updatedList[0];
            const fileContent = await invoke<string>('load_preset_file', { filePath: first.path });
            loadPresetData(JSON.parse(fileContent), first.name);
          } else {
            handleNewPreset();
          }
        }
      } catch (err: any) {
        setStatusMessage(`删除失败: ${String(err)}`);
        throw err;
      }
    },
    [currentPresetName, refreshPresetLibrary, loadPresetData, handleNewPreset],
  );

  const handleSaveCurrentPreset = useCallback(async () => {
    try {
      const presetJson = exportGraphToSillyPreset(
        allPromptsList,
        nodes,
        basePresetRef.current || undefined,
        edges,
      );
      const content = JSON.stringify(presetJson, null, 2);

      await invoke<string>('save_preset_to_library', {
        name: currentPresetName,
        content,
      });

      setStatusMessage(`💾 预设「${currentPresetName}」已持久化保存！`);
      await refreshPresetLibrary();
    } catch (error) {
      setStatusMessage(`❌ 预设「${currentPresetName}」保存失败，修改仍在界面中：${String(error)}`);
    }
  }, [allPromptsList, nodes, edges, currentPresetName, refreshPresetLibrary]);

  const handleImportRegex = () => {
    const selected = nodes.filter((n) => n.type === 'regexFilter' && n.selected);
    setRegexImportTarget(selected.length === 1 ? selected[0].id : (regexOrder[0] ?? '__new__'));
  };
  const applyRegexImport = (
    targetId: string,
    imported: Record<string, any>[],
    skipDuplicates: boolean,
  ) => {
    const target = nodes.find((n) => n.id === targetId && n.type === 'regexFilter');
    if (!target && targetId !== '__new__') throw Error('目标节点已不存在，请重新选择');
    const { rules, skipped } = appendRegexRules(
      (target?.data.regexList as any[]) ?? [],
      imported,
      skipDuplicates,
    );
    if (target) handleNodeUpdate(target.id, { regexList: rules });
    else
      setNodes((old) => [
        ...old,
        {
          id: `node-regex-${crypto.randomUUID()}`,
          type: 'regexFilter',
          position: screenToFlowPosition({ x: 700, y: 300 }),
          data: { regexList: rules, onUpdate: handleNodeUpdate },
        },
      ]);
    setStatusMessage(
      `正则导入完成：按顺序新增 ${imported.length - skipped} 条，跳过 ${skipped} 条重复规则；请保存预设`,
    );
  };
  const deleteCanvasSelection = () => {
    if (!pendingCanvasDelete) return;
    setCanvasUndo({ nodes, edges, prompts: allPromptsList });
    const removed = new Set(pendingCanvasDelete.nodes.map((n) => n.id));
    const removedEdges = new Set(pendingCanvasDelete.edges.map((e) => e.id));
    const prompts = allPromptsList.filter((p, i) => !removed.has(`prompt-${p.identifier || i}`));
    setAllPromptsList(prompts);
    basePresetRef.current = withPromptOrder(basePresetRef.current ?? {}, prompts);
    const enabledPrompts = prompts.filter((p) => p.enabled !== false);
    setNodes((old) =>
      old
        .filter((n) => !removed.has(n.id))
        .map((n) =>
          n.type === 'promptBlock'
            ? {
                ...n,
                data: {
                  ...n.data,
                  calcIndex: enabledPrompts.findIndex((p) => `prompt-${p.identifier}` === n.id) + 1,
                },
              }
            : n,
        ),
    );
    setEdges((old) =>
      old.filter(
        (e) => !removedEdges.has(e.id) && !removed.has(e.source) && !removed.has(e.target),
      ),
    );
    if (activeEditorId && removed.has(activeEditorId)) setActiveEditorId(null);
    setPendingCanvasDelete(null);
    setStatusMessage('已删除选中节点/连线并同步条目列表；保存后持久生效，可撤销本次删除');
  };

  const handleSelectPresetFromLibrary = useCallback(
    async (name: string, path: string) => {
      try {
        setStatusMessage(`正在切换预设至「${name}」...`);
        const fileContent = await invoke<string>('load_preset_file', { filePath: path });
        const parsed = JSON.parse(fileContent);
        loadPresetData(parsed, name);
        return true;
      } catch (err: any) {
        setStatusMessage(`❌ 切换预设失败: ${err?.message}`);
        return false;
      }
    },
    [loadPresetData],
  );

  const handleImportPreset = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SillyTavern Preset JSON', extensions: ['json'] }],
        title: '请选择要导入的酒馆预设 JSON 文件',
      });

      if (!selected) return;

      const filePath = typeof selected === 'string' ? selected : selected[0];
      if (filePath) {
        setStatusMessage(`正在读取并同步预设: ${filePath}...`);
        const fileContent = await invoke<string>('load_preset_file', { filePath });
        const parsed = JSON.parse(fileContent);
        const fileName = (filePath.split('\\').pop() || 'Preset').replace('.json', '');

        loadPresetData(parsed, fileName);

        await invoke<string>('save_preset_to_library', {
          name: fileName,
          content: fileContent,
        });
        await refreshPresetLibrary();
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleAddNodeFromContextMenu = useCallback(
    (type: string, screenPos: { x: number; y: number }) => {
      const flowPos = screenToFlowPosition(screenPos);
      const identifier = `custom-${crypto.randomUUID()}`;
      const newId = type === 'promptBlock' ? `prompt-${identifier}` : `node-${type}-${Date.now()}`;

      let defaultData: any = {
        name: `新建 ${type} 节点`,
      };

      if (type === 'promptBlock') {
        defaultData = {
          name: '自定义提示词块',
          role: 'system',
          depth: 0,
          order: 100,
          content: '请在此输入提示词模板...',
          enabled: true,
          collapsed: false,
          onToggle: handleNodeToggle,
          onUpdate: handleNodeUpdate,
        };
      } else if (type === 'llmInference') {
        defaultData = {
          temperature: 1.0,
          topP: 0.95,
          maxTokens: 4096,
          repPenalty: 1.0,
          onUpdate: handleNodeUpdate,
        };
      } else if (type === 'regexFilter') {
        defaultData = {
          regexList: [],
          onUpdate: handleNodeUpdate,
        };
      }

      const newNode: Node = {
        id: newId,
        type,
        position: flowPos,
        data: defaultData,
      };

      if (type === 'promptBlock')
        setAllPromptsList((prev) => {
          const next = [
            ...prev,
            {
              identifier,
              name: defaultData.name,
              content: defaultData.content,
              role: 'system',
              enabled: true,
              injection_position: 0,
              injection_depth: 0,
            },
          ];
          basePresetRef.current = withPromptOrder(basePresetRef.current ?? {}, next);
          return next;
        });
      setNodes((nds) => [...nds, newNode]);
      setStatusMessage(`✨ 已在画布上创建【${defaultData.name || type}】节点！`);
    },
    [screenToFlowPosition, handleNodeToggle, handleNodeUpdate, setNodes],
  );

  // 🌟 角色卡导入 (解析 PNG 内部的 chara / ccv3 块与专属世界书)
  const handleImportCharacterCard = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'SillyTavern Character Card PNG', extensions: ['png'] }],
        title: '请选择酒馆角色卡 PNG 图片',
      });

      if (!selected) return;
      const filePath = typeof selected === 'string' ? selected : selected[0];

      setStatusMessage(`正在深度解析角色卡与内置世界书: ${filePath}...`);
      const resStr = await invoke<string>('parse_character_card', { filePath });
      const parsedRes = JSON.parse(resStr);
      const rawCard = JSON.parse(parsedRes.cardJson);
      const cardData = rawCard.data || rawCard;

      const newChar: CharacterCardData = {
        ...cardData,
        id: `char-${crypto.randomUUID()}`,
        name: cardData.name || '未命名角色',
        creator: cardData.creator || '',
        character_version: cardData.character_version || '1.0',
        description: cardData.description || '',
        personality: cardData.personality || '',
        scenario: cardData.scenario || '',
        first_mes: cardData.first_mes || '',
        avatar_b64: parsedRes.imageB64,
        lorebook: cardData.character_book
          ? {
              ...cardData.character_book,
              name: cardData.character_book.name || '专属世界书',
              entries: cardData.character_book.entries || [],
            }
          : undefined,
        extensions: {
          ...cardData.extensions,
          alternate_greetings:
            cardData.alternate_greetings ?? cardData.extensions?.alternate_greetings,
        },
        sessions: [
          {
            id: `session-${Date.now()}`,
            title: '初遇故事',
            updatedAt: new Date().toLocaleDateString(),
            messages: [
              {
                id: 'm1',
                role: 'assistant',
                content: cardData.first_mes || '你好！很高兴遇见你。',
                timestamp: '刚刚',
              },
            ],
          },
        ],
      };

      // 保存进本地书架
      await invoke('save_character_to_library', {
        id: newChar.id,
        payloadJson: JSON.stringify(newChar),
      });

      await refreshCharacterLibrary();
      setStatusMessage(
        `🎉 角色卡《${newChar.name}》已成功上架！${
          newChar.lorebook ? `已同步内置世界书（${newChar.lorebook.entries.length} 条条目）！` : ''
        }`,
      );
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`❌ 角色卡解析失败: ${err?.message || err}`);
    }
  };

  // 角色卡删除
  const handleDeleteCharacter = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await characterWrites.current.drain(id);
      await invoke('delete_character_from_library', { id });
      characterWrites.current.forget(id);
      setStatusMessage('🗑️ 已从书架典藏中移除该角色卡');
      await refreshCharacterLibrary();
      if (chatCharacter?.id === id) {
        setChatCharacter(null);
      }
    } catch (err: any) {
      setStatusMessage(`移除角色卡失败: ${String(err)}`);
      throw err;
    }
  };

  // 角色卡开辟新对话分支

  // 更新对话

  // 保存系统全局设置
  const handleSaveSettings = async (settings: AppSettings) => {
    await invoke('save_app_settings', { settingsJson: JSON.stringify(settings, null, 2) });
    setAppSettings(settings);
    setStatusMessage('⚙️ 系统全局 AI 端点配置已成功保存！');
  };

  // 启动初始化
  useEffect(() => {
    (async () => {
      // 1. 加载预设
      const list = await refreshPresetLibrary();
      if (list && list.length > 0) {
        const latest =
          list.find((p) => p.name === localStorage.getItem('comfysilly:last-preset')) || list[0];
        try {
          const fileContent = await invoke<string>('load_preset_file', { filePath: latest.path });
          const parsed = JSON.parse(fileContent);
          loadPresetData(parsed, latest.name);
        } catch {
          // ignore
        }
      }

      // Never probe personal Downloads or auto-import sample content on a clean install.
      await Promise.all([refreshWorldbookLibrary(), refreshCharacterLibrary()]);

      // 3. 加载全局设置
      try {
        const settingsStr = await invoke<string>('load_app_settings');
        if (settingsStr) {
          setAppSettings(normalizeSettings(JSON.parse(settingsStr)));
        }
      } catch {
        // ignore
      }
    })();
  }, [refreshPresetLibrary, refreshCharacterLibrary, loadPresetData]);

  const handleRunWorkflow = async () => {
    try {
      validateWorkflow(nodes, edges);
      const preset = exportGraphToSillyPreset(
        allPromptsList,
        nodes,
        basePresetRef.current ?? undefined,
        edges,
      );
      const result = compilePrompt({
        character: chatCharacter ?? detailCharacter ?? { name: '预览角色' },
        preset,
        history: [{ role: 'user', content: '（预览用户消息，不会发送到模型）' }],
        worldbooks: globalWorldbooks,
      });
      setWorkflowPreview(
        `画布结构检查通过。当前提示词顺序以左侧条目 / prompt_order 为准；画布连线尚不是通用执行器。\n估算 tokens: ${result.estimatedTokens}（非服务端用量）\n${result.warnings.join('\n')}\n\n` +
          result.messages.map((m, i) => `[${i + 1}] ${m.role}\n${m.content}`).join('\n\n'),
      );
      setStatusMessage('提示词已编译，可检查实际顺序与内容；未消耗模型额度。');
    } catch (error) {
      setStatusMessage(`检查失败：${String(error)}`);
    }
  };

  const sidebarNodes: Node[] = useMemo(() => {
    return allPromptsList.map((p, idx) => ({
      id: `prompt-${p.identifier || idx}`,
      type: 'promptBlock',
      position: { x: 0, y: 0 },
      data: {
        identifier: p.identifier,
        calcIndex: idx + 1,
        name: p.name || `Prompt #${idx + 1}`,
        role: p.role || 'system',
        depth: p.injection_depth ?? 0,
        order: p.injection_order ?? (idx + 1) * 10,
        content: p.content || '',
        enabled: p.enabled !== false,
      },
    }));
  }, [allPromptsList]);

  return (
    <div className="app-shell" onClick={() => setContextMenu(null)}>
      <HeaderTabs
        currentTab={currentTab}
        onTabChange={(t) => {
          setCurrentTab(t);
          if (t !== 'chat') {
            setChatCharacter(null);
          }
        }}
        onImportPreset={handleImportPreset}
        onImportRegex={handleImportRegex}
        onSaveCurrentPreset={handleSaveCurrentPreset}
        onNewPreset={handleNewPreset}
        onDeletePreset={handleDeletePreset}
        onRunWorkflow={handleRunWorkflow}
        onOpenSettings={() => {
          setSettingsSection('models');
          setSettingsOpen(true);
        }}
        persona={personaOf(appSettings)}
        onOpenPersona={() => {
          setSettingsSection('personas');
          setSettingsOpen(true);
        }}
        presetList={presetList}
        currentPresetName={currentPresetName}
        onSelectPresetFromLibrary={handleSelectPresetFromLibrary}
      />

      {/* 🌟 系统与 AI 提供商弹窗设置界面 */}
      <LorebookModal
        isOpen={lorebookModalState.isOpen}
        title={lorebookModalState.title}
        lorebook={lorebookModalState.data}
        onClose={() => setLorebookModalState({ ...lorebookModalState, isOpen: false })}
        onSave={lorebookModalState.onSaveCallback}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialSettings={appSettings}
        initialSection={settingsSection}
        onPreviewPreferences={setPreviewPreferences}
      />

      <main className="app-main">
        {currentTab === 'preset' && (
          <>
            <PresetSidebar
              nodes={sidebarNodes}
              onToggleNode={handleNodeToggle}
              onFocusNode={handleFocusNode}
              onOpenEditor={handleOpenEditor}
              onReorderList={handleReorderList}
            />

            <PromptFloatingWindow
              nodeId={activeEditorId}
              nodes={sidebarNodes}
              onClose={() => setActiveEditorId(null)}
              onUpdateNode={handleNodeUpdate}
            />

            <div className="flex-1 h-full relative" onContextMenu={handleContextMenu}>
              <RegexNodeActions.Provider value={regexActions}>
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeContextMenu={(event, node) => {
                    const target = event.target;
                    if (
                      target instanceof HTMLElement &&
                      target.closest('input,textarea,select,[contenteditable="true"]')
                    ) {
                      event.stopPropagation();
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
                  }}
                  onEdgeContextMenu={(event, edge) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setContextMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
                  }}
                  connectOnClick
                  connectionRadius={24}
                  deleteKeyCode={['Backspace', 'Delete']}
                  onBeforeDelete={async (selection) => {
                    const target = document.activeElement;
                    if (
                      document.querySelector('[role="dialog"]') ||
                      (target instanceof HTMLElement &&
                        (target.matches('input,textarea,select') || target.isContentEditable))
                    )
                      return false;
                    setPendingCanvasDelete(selection);
                    return false;
                  }}
                  nodeTypes={nodeTypes}
                  fitView
                  colorMode={(previewPreferences ?? preferencesOf(appSettings)).theme}
                  minZoom={0.05}
                  maxZoom={2}
                  panOnDrag={[1, 2]}
                  zoomOnScroll={true}
                  panOnScroll={false}
                  selectionOnDrag={false}
                  onlyRenderVisibleElements={true}
                  defaultEdgeOptions={{
                    animated: false,
                  }}
                  className="bg-[#090b10]"
                >
                  <Background
                    color="var(--line)"
                    gap={24}
                    size={1.5}
                    variant={BackgroundVariant.Dots}
                    className="opacity-70"
                  />
                  <Controls
                    position="bottom-left"
                    className="!bg-slate-900/90 !border-slate-800 !rounded-xl !shadow-2xl overflow-hidden [&>button]:!bg-transparent [&>button]:!border-b [&>button]:!border-slate-800 [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-800"
                  />
                  <MiniMap
                    position="bottom-right"
                    nodeStrokeColor="var(--faint)"
                    nodeColor="var(--panel-3)"
                    nodeBorderRadius={6}
                    maskColor="rgba(9, 11, 16, 0.75)"
                    className="!bg-slate-950/80 !border-slate-800 !rounded-xl !shadow-2xl overflow-hidden"
                  />
                </ReactFlow>
              </RegexNodeActions.Provider>
              <div className="absolute bottom-4 left-20 z-10 flex gap-2">
                <button
                  className="button"
                  disabled={!nodes.some((n) => n.selected) && !edges.some((e) => e.selected)}
                  onClick={() =>
                    setPendingCanvasDelete({
                      nodes: nodes.filter((n) => n.selected),
                      edges: edges.filter((e) => e.selected),
                    })
                  }
                >
                  删除选中节点/连线
                </button>
                {canvasUndo && (
                  <button
                    className="button"
                    onClick={() => {
                      setNodes(canvasUndo.nodes);
                      setEdges(canvasUndo.edges);
                      setAllPromptsList(canvasUndo.prompts);
                      basePresetRef.current = withPromptOrder(
                        basePresetRef.current ?? {},
                        canvasUndo.prompts,
                      );
                      setCanvasUndo(null);
                      setStatusMessage('已撤销画布删除，请保存预设');
                    }}
                  >
                    撤销画布删除
                  </button>
                )}
              </div>

              {contextMenu && (
                <CanvasContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  onClose={() => setContextMenu(null)}
                  onAddNode={handleAddNodeFromContextMenu}
                  deleteLabel={contextMenu.edgeId ? '删除此连线' : '删除此节点'}
                  onDelete={
                    contextMenu.nodeId || contextMenu.edgeId
                      ? () =>
                          setPendingCanvasDelete({
                            nodes: nodes.filter((n) => n.id === contextMenu.nodeId),
                            edges: edges.filter((e) => e.id === contextMenu.edgeId),
                          })
                      : undefined
                  }
                />
              )}

              <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800/80 text-xs shadow-lg max-w-xl truncate">
                <span className="flex h-2 w-2 relative flex-shrink-0">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-25"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-slate-300 font-medium truncate">{statusMessage}</span>
              </div>

              <div className="absolute top-4 right-4 z-10 flex items-center space-x-3 px-3 py-1.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800/80 text-[11px] font-mono text-slate-400 shadow-lg">
                <span className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-violet-400" />
                  <span>渲染激活节点: {nodes.length}</span>
                </span>
                <span className="text-slate-700">|</span>
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>连线: {edges.length}</span>
                </span>
              </div>
            </div>
          </>
        )}

        {/* 🌟 角色卡书架典藏馆与沉浸式对话视界 */}
        {currentTab === 'chat' && (
          <div className="w-full h-full relative">
            {chatCharacter ? (
              <Suspense
                fallback={
                  <div className="p-8 text-sm text-slate-400" role="status">
                    正在加载对话视图…
                  </div>
                }
              >
                <ChatRoom
                  key={chatCharacter.id}
                  character={chatCharacter}
                  settings={
                    previewPreferences && appSettings
                      ? { ...appSettings, preferences: previewPreferences }
                      : appSettings
                  }
                  preset={activePreset}
                  presetName={currentPresetName}
                  presetKey={
                    presetList.find((p) => p.name === currentPresetName)?.path ?? currentPresetName
                  }
                  presets={presetList}
                  onSelectPreset={handleSelectPresetFromLibrary}
                  worldbooks={globalWorldbooks}
                  onOpenSettings={() => {
                    setSettingsSection('models');
                    setSettingsOpen(true);
                  }}
                  initialSessionId={chatSessionId}
                  onBackToShelf={() => setChatCharacter(null)}
                  onUpdateCharacterSessions={async (updated) => {
                    await handlePatchCharacter(updated, {
                      sessions: updated.sessions,
                      activeSessionId: updated.activeSessionId,
                    });
                  }}
                  onPatchCharacter={async (patch) => {
                    await handlePatchCharacter(chatCharacter, patch);
                  }}
                  onOpenLorebookModal={() => handleOpenCharacterLorebook(chatCharacter)}
                />
              </Suspense>
            ) : detailCharacter ? (
              <CharacterDetail
                key={detailCharacter.id}
                character={detailCharacter}
                onBack={() => setDetailCharacter(null)}
                onStartChat={(sessionId, updated) => {
                  setChatCharacter(updated ?? detailCharacter);
                  setChatSessionId(sessionId);
                }}
                onNewChat={(updated) => {
                  const source = updated ?? detailCharacter;
                  const session = {
                    id: crypto.randomUUID(),
                    title: `新对话 #${(source.sessions?.length ?? 0) + 1}`,
                    updatedAt: new Date().toISOString(),
                    messages: [
                      {
                        id: crypto.randomUUID(),
                        role: 'assistant' as const,
                        name: source.name,
                        content: source.first_mes || '你好！',
                        timestamp: new Date().toISOString(),
                      },
                    ],
                  };
                  void handlePatchCharacter(source, {
                    sessions: [session, ...(source.sessions ?? [])],
                    activeSessionId: session.id,
                  })
                    .then(() => {
                      setChatSessionId(session.id);
                      setChatCharacter({
                        ...source,
                        sessions: [session, ...(source.sessions ?? [])],
                        activeSessionId: session.id,
                      });
                    })
                    .catch((error) => setStatusMessage(String(error)));
                }}
                onUpdateCharacter={handleUpdateCharacter}
                onOpenLorebookModal={() => handleOpenCharacterLorebook(detailCharacter)}
              />
            ) : (
              <CharacterShelf
                characters={characters}
                onCreateCard={async () => {
                  try {
                    const card: CharacterCardData = {
                      id: `char-${crypto.randomUUID()}`,
                      name: '新角色',
                      creator: '',
                      character_version: '1.0',
                      description: '',
                      personality: '',
                      scenario: '',
                      first_mes: '你好！',
                      avatar_b64:
                        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="320"%3E%3Crect width="240" height="320" fill="%232d2054"/%3E%3Ctext x="120" y="170" text-anchor="middle" fill="white" font-size="60"%3E%E2%9C%A6%3C/text%3E%3C/svg%3E',
                      sessions: [],
                    };
                    await handlePatchCharacter(card, {});
                    await refreshCharacterLibrary();
                    setDetailCharacter(card);
                  } catch (error) {
                    setStatusMessage(`创建角色失败：${String(error)}`);
                  }
                }}
                onImportCard={handleImportCharacterCard}
                onSelectCharacter={(card) => setDetailCharacter(card)}
                onDeleteCharacter={handleDeleteCharacter}
                onNewSessionForCard={(id, e) => {
                  e.stopPropagation();
                  const target = characters.find((c) => c.id === id);
                  if (target) {
                    const session = {
                      id: crypto.randomUUID(),
                      title: `新对话 #${(target.sessions?.length ?? 0) + 1}`,
                      updatedAt: new Date().toISOString(),
                      messages: [
                        {
                          id: crypto.randomUUID(),
                          role: 'assistant' as const,
                          content: target.first_mes || '你好！',
                          timestamp: new Date().toISOString(),
                        },
                      ],
                    };
                    void handlePatchCharacter(target, {
                      sessions: [session, ...(target.sessions ?? [])],
                      activeSessionId: session.id,
                    })
                      .then(() => {
                        setChatSessionId(session.id);
                        setChatCharacter({
                          ...target,
                          sessions: [session, ...(target.sessions ?? [])],
                          activeSessionId: session.id,
                        });
                      })
                      .catch((error) => setStatusMessage(String(error)));
                  }
                }}
              />
            )}
          </div>
        )}

        {/* 🌟 全局世界书典藏库 (含独立开关、导入、新建、编辑《幻想乡缘起》) */}
        {currentTab === 'worldbook' && (
          <WorldbookView
            worldbooks={globalWorldbooks}
            onImportWorldbook={handleImportWorldbook}
            onNewWorldbook={handleNewWorldbook}
            onDeleteWorldbook={handleDeleteWorldbook}
            onToggleWorldbook={handleToggleWorldbook}
            onOpenEditor={handleOpenGlobalWorldbookEditor}
          />
        )}

        {currentTab === 'plugins' && (
          <section className="page route-enter">
            <div className="page-inner">
              <header className="page-heading">
                <div>
                  <span className="eyebrow">OPEN, WITH BOUNDARIES</span>
                  <h1>扩展与兼容</h1>
                  <p>让角色卡在聊天中真正工作，也让不支持的能力有清楚的边界。</p>
                </div>
              </header>
              <div className="extension-grid">
                {[
                  {
                    icon: MessageSquare,
                    title: '消息内交互前端',
                    status: '已接入',
                    text: 'HTML / JavaScript 在消息内的隔离 iframe 中运行。后台脚本、变量与事件可协作，不会因变量更新反复重载。',
                  },
                  {
                    icon: Code,
                    title: '酒馆助手兼容层',
                    status: '部分支持',
                    text: '已实现常见变量、消息、世界书、正则 API 与基础 Slash 命令。角色可请求实际模型；未支持的接口会报告错误，不会伪造成功。',
                  },
                  {
                    icon: ShieldCheck,
                    title: '按需信任与隔离',
                    status: '默认隔离',
                    text: '角色脚本默认不执行。主动信任后可以访问当前对话、联网及发起生成，但不能读取模型密钥、宿主 DOM 或桌面文件。',
                  },
                  {
                    icon: Workflow,
                    title: '预设与工作流',
                    status: '持续完善',
                    text: '预设 prompt_order 与显示正则已经接入。节点连线可编辑并检查结构，但尚不是任意 DAG 执行器。EJS 模板、QuickReply、TTS、生图和任意酒馆 DOM 插件尚未完整兼容。',
                  },
                ].map((item) => (
                  <article className="extension-card" key={item.title}>
                    <item.icon size={24} />
                    <span className="badge">{item.status}</span>
                    <h2>{item.title}</h2>
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
        {workflowPreview !== null && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8">
            <section className="bg-slate-950 border border-slate-700 rounded-2xl p-5 w-full max-w-4xl max-h-[85vh] flex flex-col">
              <header className="flex justify-between text-slate-100 mb-3">
                <h2>实际提示词预览</h2>
                <button onClick={() => setWorkflowPreview(null)} className="cursor-pointer">
                  关闭
                </button>
              </header>
              <pre className="overflow-auto text-xs whitespace-pre-wrap text-slate-300 select-text">
                {workflowPreview}
              </pre>
            </section>
          </div>
        )}
      </main>
      {regexImportTarget !== null && (
        <RegexImportDialog
          targetId={regexImportTarget}
          targets={regexOrder.map((id, i) => ({
            id,
            name: `正则节点 #${i + 1} · ${String((nodes.find((n) => n.id === id)?.data.regexList as any[])?.length ?? 0)} 条`,
          }))}
          onClose={() => setRegexImportTarget(null)}
          onApply={applyRegexImport}
        />
      )}
      <ConfirmDialog
        open={!!pendingCanvasDelete}
        onClose={() => setPendingCanvasDelete(null)}
        title="删除画布节点或连线？"
        description={`将删除 ${pendingCanvasDelete?.nodes.length ?? 0} 个节点及选中的连线。提示词会从条目列表同步移除，相连的线会清理；可以撤销本次删除。`}
        danger
        confirmText="确认删除"
        onConfirm={deleteCanvasSelection}
      />
      {toast && (
        <div className="app-toast" role="status">
          <span>{toast}</span>
          <button className="icon-button" aria-label="关闭通知" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowWorkspace />
    </ReactFlowProvider>
  );
}
