import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Radio,
  Tv,
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Plus,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  Send,
  Sliders,
  Database,
  Download,
  Eye,
  EyeOff,
  Search,
  ExternalLink,
  Loader2,
  Sparkles,
  Zap,
  Activity,
} from 'lucide-react';
import { API_BASE_URL } from '../config/api';

// Presentation only: preserve the automation hooks and handlers below.
const showTelegramAutomationUI = false;

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('channels');
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [channels, setChannels] = useState([]);
  const [imports, setImports] = useState([]);
  const [importStatusFilter, setImportStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState(null);

  // New Channel Modal State
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannel, setNewChannel] = useState({
    channelId: '',
    channelTitle: '',
    channelUsername: '',
    autoImport: true,
    autoPublish: true,
    rightsStatus: 'verified',
    licenseType: 'authorized_redistribution',
    licenseNotes: '',
  });

  // Manual Import State
  const [manualInput, setManualInput] = useState({
    channelId: '',
    messageId: '',
    fileId: '',
    fileName: '',
    caption: '',
  });

  // Webhook Status
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [webhookUrlInput, setWebhookUrlInput] = useState('');

  // Diagnostics & Monitoring State
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const fetchDiagnostics = async () => {
    try {
      setDiagLoading(true);
      const res = await axios.get(`${API_BASE_URL}/admin/diagnostics`);
      setDiagnostics(res.data?.data || null);
    } catch (err) {
      console.error('[ADMIN] Error loading diagnostics:', err);
      showMessage('error', `Diagnostics failed: ${err.message}`);
    } finally {
      setDiagLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [importStatusFilter]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [analyticsRes, channelsRes, importsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/admin/analytics`).catch(() => ({ data: { data: null } })),
        axios.get(`${API_BASE_URL}/admin/channels`).catch(() => ({ data: { data: [] } })),
        axios.get(`${API_BASE_URL}/admin/imports${importStatusFilter ? `?status=${importStatusFilter}` : ''}`).catch(() => ({ data: { data: [] } })),
      ]);

      setAnalytics(analyticsRes.data?.data || null);
      setChannels(channelsRes.data?.data || []);
      setImports(importsRes.data?.data || []);
    } catch (err) {
      console.error('[ADMIN] Error loading dashboard:', err);
      showMessage('error', 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // Add Authorized Channel
  const handleAddChannel = async (e) => {
    e.preventDefault();
    if (!newChannel.channelId) {
      showMessage('error', 'Channel ID is required');
      return;
    }

    try {
      setActionLoading(true);
      const res = await axios.post(`${API_BASE_URL}/admin/channels`, newChannel);
      if (res.data?.success) {
        showMessage('success', 'Telegram channel authorized successfully');
        setShowAddChannel(false);
        setNewChannel({
          channelId: '',
          channelTitle: '',
          channelUsername: '',
          autoImport: true,
          autoPublish: true,
          rightsStatus: 'verified',
          licenseType: 'authorized_redistribution',
          licenseNotes: '',
        });
        fetchDashboardData();
      }
    } catch (err) {
      showMessage('error', err.response?.data?.message || err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Toggle Channel Setting
  const handleUpdateChannel = async (id, patch) => {
    try {
      await axios.put(`${API_BASE_URL}/admin/channels/${id}`, patch);
      showMessage('success', 'Channel updated');
      fetchDashboardData();
    } catch (err) {
      showMessage('error', err.message);
    }
  };

  // Delete / Revoke Channel
  const handleDeleteChannel = async (id, title) => {
    if (!window.confirm(`Are you sure you want to revoke authorization for "${title}"?`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/admin/channels/${id}`);
      showMessage('success', 'Channel authorization revoked');
      fetchDashboardData();
    } catch (err) {
      showMessage('error', err.message);
    }
  };

  // Re-verify Bot Access
  const handleVerifyChannel = async (id) => {
    try {
      setActionLoading(true);
      const res = await axios.post(`${API_BASE_URL}/admin/channels/${id}/verify`);
      if (res.data?.data?.ok) {
        showMessage('success', `Bot access verified: "${res.data.data.title}" (Admin/Member: ${res.data.data.isMember})`);
      } else {
        showMessage('error', `Verification failed: ${res.data?.data?.error || 'Unknown error'}`);
      }
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Publish Pending Import
  const handlePublishImport = async (id) => {
    try {
      setActionLoading(true);
      await axios.post(`${API_BASE_URL}/admin/imports/${id}/publish`);
      showMessage('success', 'Movie approved and published to website');
      fetchDashboardData();
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Retry Failed Import
  const handleRetryImport = async (id) => {
    try {
      setActionLoading(true);
      const res = await axios.post(`${API_BASE_URL}/admin/imports/${id}/retry`);
      if (res.data?.success) {
        showMessage('success', `Retry successful: Status is now "${res.data.data?.status}"`);
        fetchDashboardData();
        fetchDiagnostics();
      } else {
        showMessage('error', `Retry failed: ${res.data?.data?.reason || 'Unknown error'}`);
      }
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Trigger Manual Import
  const handleManualImport = async (e) => {
    e.preventDefault();
    if (!manualInput.fileId && (!manualInput.channelId || !manualInput.messageId)) {
      showMessage('error', 'Provide either a file_id or both channel ID and message ID');
      return;
    }

    try {
      setActionLoading(true);
      const res = await axios.post(`${API_BASE_URL}/telegram/manual-import`, manualInput);
      if (res.data?.success) {
        showMessage('success', `Manual import complete! Result: ${res.data.result?.status} for "${res.data.result?.movieTitle || 'Movie'}"`);
        setManualInput({ channelId: '', messageId: '', fileId: '', fileName: '', caption: '' });
        fetchDashboardData();
      } else {
        showMessage('error', `Import rejected: ${res.data?.result?.reason || 'Unknown error'}`);
      }
    } catch (err) {
      showMessage('error', err.response?.data?.message || err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Fetch Webhook Info
  const fetchWebhookInfo = async () => {
    try {
      setActionLoading(true);
      const res = await axios.get(`${API_BASE_URL}/telegram/webhook-info`);
      setWebhookInfo(res.data?.data || null);
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Register Webhook
  const handleRegisterWebhook = async (e) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      const res = await axios.post(`${API_BASE_URL}/telegram/setup-webhook`, {
        webhookUrl: webhookUrlInput || undefined,
      });
      if (res.data?.success) {
        showMessage('success', `Webhook registered! URL: ${res.data.webhookUrl}`);
        fetchWebhookInfo();
      } else {
        showMessage('error', `Registration failed: ${res.data?.description}`);
      }
    } catch (err) {
      showMessage('error', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'published':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Published
          </span>
        );
      case 'requires_review':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3 mr-1" /> Requires Review
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3 h-3 mr-1" /> Failed
          </span>
        );
      case 'rights_expired':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <ShieldAlert className="w-3 h-3 mr-1" /> Rights Expired
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-500/20 text-slate-300 border border-slate-500/30">
            {status || 'Pending'}
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#e1e7ef] pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      {!showTelegramAutomationUI && (
        <h1 className="max-w-7xl mx-auto text-3xl sm:text-4xl font-black text-white tracking-tight">Admin Dashboard</h1>
      )}
      {showTelegramAutomationUI && (
        <>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center space-x-2.5 text-xs font-black uppercase tracking-wider text-purple-400 mb-1">
              <Sparkles className="w-4 h-4" />
              <span>Zinemo Automated Pipeline</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              Telegram Movie Automation
            </h1>
            <p className="text-sm text-[#8b94a6] mt-1">
              Manage authorized Telegram channels, automatic quality ingest (480p - 4K), licensing compliance, and webhooks.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchDashboardData}
              disabled={loading}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-sm transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => setShowAddChannel(true)}
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-extrabold text-sm shadow-lg shadow-purple-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Authorize Channel</span>
            </button>
          </div>
        </div>

        {/* Global Alert Notification */}
        {message && (
          <div
            className={`p-4 rounded-2xl border text-sm font-semibold flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="underline text-xs">
              Dismiss
            </button>
          </div>
        )}

        {/* Analytics Highlights */}
        {analytics?.overview && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="rounded-2xl border border-white/10 bg-[#121620] p-4">
              <span className="text-xs font-semibold text-[#8b94a6] uppercase tracking-wider">Channels</span>
              <p className="text-2xl font-black text-white mt-1">{analytics.overview.channels || 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#121620] p-4">
              <span className="text-xs font-semibold text-[#8b94a6] uppercase tracking-wider">Movies</span>
              <p className="text-2xl font-black text-white mt-1">{analytics.overview.movies || 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#121620] p-4">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Published</span>
              <p className="text-2xl font-black text-emerald-400 mt-1">{analytics.overview.imports?.published || 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#121620] p-4">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Needs Review</span>
              <p className="text-2xl font-black text-amber-400 mt-1">{analytics.overview.imports?.requires_review || 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#121620] p-4">
              <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">Failed</span>
              <p className="text-2xl font-black text-rose-400 mt-1">{analytics.overview.imports?.failed || 0}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#121620] p-4">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Total Downloads</span>
              <p className="text-2xl font-black text-blue-400 mt-1">{analytics.overview.totalDownloads || 0}</p>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 space-x-6 overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setActiveTab('channels')}
            className={`pb-4 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'channels'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-[#8b94a6] hover:text-white'
            }`}
          >
            Authorized Channels ({channels.length})
          </button>
          <button
            onClick={() => setActiveTab('imports')}
            className={`pb-4 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'imports'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-[#8b94a6] hover:text-white'
            }`}
          >
            Import Queue & History
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`pb-4 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'manual'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-[#8b94a6] hover:text-white'
            }`}
          >
            Manual Import Tool
          </button>
          <button
            onClick={() => {
              setActiveTab('webhook');
              fetchWebhookInfo();
            }}
            className={`pb-4 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'webhook'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-[#8b94a6] hover:text-white'
            }`}
          >
            Webhook Configuration
          </button>
          <button
            onClick={() => {
              setActiveTab('diagnostics');
              fetchDiagnostics();
            }}
            className={`pb-4 text-sm font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center space-x-2 ${
              activeTab === 'diagnostics'
                ? 'border-purple-500 text-white'
                : 'border-transparent text-[#8b94a6] hover:text-white'
            }`}
          >
            <Activity className="w-4 h-4 text-purple-400" />
            <span>Pipeline Diagnostics</span>
          </button>
        </div>

        {/* TAB 1: Connected Telegram Channels */}
        {activeTab === 'channels' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Registered Channels</h2>
              <span className="text-xs text-[#8b94a6]">Only approved channels are processed by the automated worker.</span>
            </div>

            {channels.length === 0 ? (
              <div className="text-center py-16 rounded-3xl border border-white/10 bg-[#121620]">
                <Radio className="w-12 h-12 text-[#8b94a6] mx-auto mb-3 opacity-40" />
                <h3 className="text-lg font-bold text-white">No Authorized Channels Yet</h3>
                <p className="text-sm text-[#8b94a6] max-w-md mx-auto mt-1 mb-6">
                  Add your Telegram channel ID below to start automatically detecting new movie releases and direct downloads.
                </p>
                <button
                  onClick={() => setShowAddChannel(true)}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm cursor-pointer"
                >
                  Authorize First Channel
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="rounded-2xl border border-white/10 bg-[#121620] p-5 flex flex-col justify-between space-y-4 hover:border-white/20 transition-all"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-[#8b94a6] bg-black/40 px-2.5 py-1 rounded-lg">
                          {ch.channelId}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                            ch.rightsStatus === 'verified'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {ch.rightsStatus === 'verified' ? 'Rights Verified' : ch.rightsStatus}
                        </span>
                      </div>

                      <h3 className="text-lg font-bold text-white">{ch.channelTitle}</h3>
                      {ch.channelUsername && (
                        <p className="text-xs text-purple-400 font-semibold">@{ch.channelUsername}</p>
                      )}

                      <div className="mt-4 pt-3 border-t border-white/10 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-[#8b94a6]">Auto-Import:</span>
                          <button
                            onClick={() => handleUpdateChannel(ch.id, { autoImport: !ch.autoImport })}
                            className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                              ch.autoImport ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-slate-400'
                            }`}
                          >
                            {ch.autoImport ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[#8b94a6]">Auto-Publish:</span>
                          <button
                            onClick={() => handleUpdateChannel(ch.id, { autoPublish: !ch.autoPublish })}
                            className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors ${
                              ch.autoPublish ? 'bg-purple-500/20 text-purple-300' : 'bg-white/10 text-slate-400'
                            }`}
                          >
                            {ch.autoPublish ? 'Enabled' : 'Needs Review'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[#8b94a6]">
                          <span>Total Ingested:</span>
                          <span className="font-bold text-white">{ch._count?.imports || 0} posts</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleVerifyChannel(ch.id)}
                        disabled={actionLoading}
                        className="text-xs font-bold text-purple-400 hover:text-purple-300 px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-all cursor-pointer"
                      >
                        Verify Bot
                      </button>
                      <button
                        onClick={() => handleDeleteChannel(ch.id, ch.channelTitle)}
                        className="text-xs font-bold text-rose-400 hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-500/10 transition-all cursor-pointer"
                        title="Revoke Source Access"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Import Queue & History */}
        {activeTab === 'imports' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-[#8b94a6]">Filter:</span>
                {['', 'published', 'requires_review', 'failed'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setImportStatusFilter(st)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      importStatusFilter === st
                        ? 'bg-purple-600 text-white'
                        : 'bg-white/5 text-[#8b94a6] hover:bg-white/10'
                    }`}
                  >
                    {st ? st.replace('_', ' ').toUpperCase() : 'ALL'}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[#8b94a6]">{imports.length} imports loaded</span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#121620] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-[#8b94a6]">
                  <thead className="bg-black/30 text-xs uppercase font-extrabold text-[#8b94a6] border-b border-white/10">
                    <tr>
                      <th className="p-4">Status</th>
                      <th className="p-4">Detected Title</th>
                      <th className="p-4">Resolution</th>
                      <th className="p-4">File Name & Size</th>
                      <th className="p-4">Source Channel</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-medium">
                    {imports.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="p-8 text-center text-[#8b94a6]">
                          No imports found in this filter view.
                        </td>
                      </tr>
                    ) : (
                      imports.map((item) => (
                        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="p-4">{getStatusBadge(item.status)}</td>
                          <td className="p-4 text-white font-bold">
                            <div>{item.parsedTitle || 'Processing...'}</div>
                            {item.parsedYear && <span className="text-xs text-purple-400 font-semibold">{item.parsedYear}</span>}
                          </td>
                          <td className="p-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-extrabold bg-white/10 text-white">
                              {item.parsedQuality || 'Auto'}
                            </span>
                            {item.resolutionVerified && (
                              <span className="ml-1.5 text-[10px] text-emerald-400 font-bold">✓ FFprobe</span>
                            )}
                          </td>
                          <td className="p-4 max-w-xs truncate text-xs">
                            <div className="text-white truncate" title={item.fileName}>
                              {item.fileName}
                            </div>
                            <span className="text-[#8b94a6]">
                              {item.fileSizeBytes ? `${(item.fileSizeBytes / (1024 ** 3)).toFixed(1)} GB` : ''}
                            </span>
                          </td>
                          <td className="p-4 text-xs">
                            <div className="text-white">{item.source?.channelTitle || item.sourceChannelId}</div>
                            <div className="text-[#8b94a6]">Msg #{item.messageId}</div>
                          </td>
                          <td className="p-4 text-right space-x-2">
                            {item.status === 'requires_review' && (
                              <button
                                onClick={() => handlePublishImport(item.id)}
                                disabled={actionLoading}
                                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer transition-all"
                              >
                                Publish
                              </button>
                            )}
                            {item.status === 'failed' && (
                              <button
                                onClick={() => handleRetryImport(item.id)}
                                disabled={actionLoading}
                                className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer transition-all"
                              >
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Manual Import Tool */}
        {activeTab === 'manual' && (
          <div className="max-w-2xl rounded-3xl border border-white/10 bg-[#121620] p-6 sm:p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Manual Telegram Import</h2>
              <p className="text-xs text-[#8b94a6] mt-1">
                Provide a Telegram file_id or post details to immediately extract metadata, detect video quality, and attach direct download links.
              </p>
            </div>

            <form onSubmit={handleManualImport} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  Telegram File ID (Recommended)
                </label>
                <input
                  type="text"
                  placeholder="e.g. BAAQAgADeAADY..."
                  value={manualInput.fileId}
                  onChange={(e) => setManualInput({ ...manualInput, fileId: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                    Channel ID
                  </label>
                  <input
                    type="text"
                    placeholder="-1001234567890"
                    value={manualInput.channelId}
                    onChange={(e) => setManualInput({ ...manualInput, channelId: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                    Message ID
                  </label>
                  <input
                    type="number"
                    placeholder="1234"
                    value={manualInput.messageId}
                    onChange={(e) => setManualInput({ ...manualInput, messageId: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  File Name (e.g. Movie.Title.2026.1080p.mkv)
                </label>
                <input
                  type="text"
                  placeholder="Inception.2010.1080p.BluRay.x264.mkv"
                  value={manualInput.fileName}
                  onChange={(e) => setManualInput({ ...manualInput, fileName: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  Telegram Message Caption (Optional)
                </label>
                <textarea
                  rows="3"
                  placeholder="Paste Telegram caption or quality description here..."
                  value={manualInput.caption}
                  onChange={(e) => setManualInput({ ...manualInput, caption: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-extrabold text-white text-sm shadow-lg shadow-purple-500/25 transition-all cursor-pointer flex items-center justify-center space-x-2"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                <span>Trigger Automated Pipeline</span>
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: Webhook Configuration */}
        {activeTab === 'webhook' && (
          <div className="max-w-2xl rounded-3xl border border-white/10 bg-[#121620] p-6 sm:p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Telegram Webhook Configuration</h2>
              <p className="text-xs text-[#8b94a6] mt-1">
                Configure Telegram to deliver real-time channel posts directly to this website's automated import webhook.
              </p>
            </div>

            <form onSubmit={handleRegisterWebhook} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  Public Webhook URL (HTTPS required by Telegram)
                </label>
                <input
                  type="url"
                  placeholder="https://yourdomain.com/api/telegram/webhook"
                  value={webhookUrlInput}
                  onChange={(e) => setWebhookUrlInput(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="py-3 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 font-extrabold text-white text-xs transition-all cursor-pointer flex items-center space-x-2"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Register with Telegram Bot API</span>
              </button>
            </form>

            {webhookInfo && (
              <div className="pt-6 border-t border-white/10 space-y-3">
                <h3 className="text-sm font-bold text-white">Current Telegram Webhook Info</h3>
                <div className="p-4 rounded-2xl bg-black/40 border border-white/5 font-mono text-xs text-[#8b94a6] space-y-1.5">
                  <div><span className="text-white">Active URL:</span> {webhookInfo.url || 'None (using getUpdates polling)'}</div>
                  <div><span className="text-white">Custom Certificate:</span> {webhookInfo.has_custom_certificate ? 'Yes' : 'No'}</div>
                  <div><span className="text-white">Pending Updates:</span> {webhookInfo.pending_update_count || 0}</div>
                  {webhookInfo.last_error_message && (
                    <div className="text-rose-400"><span className="text-white">Last Error:</span> {webhookInfo.last_error_message}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: Pipeline Diagnostics & Monitoring */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                  <Activity className="w-5 h-5 text-purple-400" />
                  <span>Telegram Synchronization & Download Diagnostics</span>
                </h2>
                <p className="text-xs text-[#8b94a6] mt-0.5">
                  Live health check of Local Bot API connectivity, download endpoints, import queues, and quality variants.
                </p>
              </div>

              <button
                onClick={fetchDiagnostics}
                disabled={diagLoading}
                className="self-start sm:self-auto px-4 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
                <span>Refresh Diagnostics</span>
              </button>
            </div>

            {diagLoading && !diagnostics ? (
              <div className="text-center py-20 rounded-3xl border border-white/10 bg-[#121620]">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-3" />
                <p className="text-sm font-bold text-white">Running full pipeline diagnostic checks...</p>
              </div>
            ) : diagnostics ? (
              <div className="space-y-6">
                {/* System Services Status Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* GramJS MTProto Userbot */}
                  <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b94a6]">MTProto Userbot</span>
                        {diagnostics.userbot?.connected ? (
                          <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> CONNECTED
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <AlertTriangle className="w-3 h-3 mr-1" /> STANDBY
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-white truncate">
                        {diagnostics.userbot?.phone || (diagnostics.userbot?.sessionConfigured ? 'Session Configured' : 'No Phone Configured')}
                      </p>
                      <p className="text-[11px] text-[#8b94a6] truncate mt-0.5">
                        API ID: {diagnostics.userbot?.apiId ? 'Verified' : 'Not Set'} &bull; Zero-Storage Copy
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-[#8b94a6]">
                      <span>Copy Mechanism:</span>
                      <span className="font-mono text-emerald-400 font-bold">Cloud Server-Side</span>
                    </div>
                  </div>

                  {/* Destination Channel */}
                  <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b94a6]">Target Channel</span>
                        {diagnostics.destinationChannel?.accessible ? (
                          <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> ACCESSIBLE
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <AlertTriangle className="w-3 h-3 mr-1" /> VERIFY ID
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-white truncate">
                        {diagnostics.destinationChannel?.title || `ID: ${diagnostics.destinationChannel?.targetChatId || 'Not set'}`}
                      </p>
                      <p className="text-[11px] text-[#8b94a6] truncate font-mono mt-0.5">
                        {diagnostics.destinationChannel?.username ? `@${diagnostics.destinationChannel.username}` : `Chat: ${diagnostics.destinationChannel?.targetChatId || 'None'}`}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-[#8b94a6]">
                      <span>Zero-Disk Target:</span>
                      <span className="text-emerald-400 font-bold">Verified</span>
                    </div>
                  </div>

                  {/* Telegram Local Bot API */}
                  <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b94a6]">Local Bot API</span>
                        {diagnostics.localBotApi?.connected ? (
                          <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> ONLINE
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            <XCircle className="w-3 h-3 mr-1" /> OFFLINE
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-white truncate">
                        {diagnostics.localBotApi?.botUsername ? `@${diagnostics.localBotApi.botUsername}` : 'Local API Server'}
                      </p>
                      <p className="text-[11px] text-[#8b94a6] truncate font-mono mt-0.5">
                        {diagnostics.localBotApi?.url || 'http://telegram-api:8081'}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-[#8b94a6]">
                      <span>Latency:</span>
                      <span className="font-mono text-white font-bold">
                        {diagnostics.localBotApi?.latencyMs ? `${diagnostics.localBotApi.latencyMs} ms` : 'N/A'}
                      </span>
                    </div>
                  </div>

                  {/* Direct Download Service */}
                  <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b94a6]">Download Service</span>
                        <span className="inline-flex items-center text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> HEALTHY
                        </span>
                      </div>
                      <p className="text-sm font-bold text-white">Signed Stream & Range</p>
                      <p className="text-[11px] text-[#8b94a6] mt-0.5">
                        {diagnostics.downloadHealth?.tokenGenerationValid ? 'HMAC Token & Crypto Verified' : 'Standard Fallback'}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-[#8b94a6]">
                      <span>HTTP Range Support:</span>
                      <span className="text-emerald-400 font-bold">RFC 7233 Active</span>
                    </div>
                  </div>

                  {/* Last Received Telegram Post */}
                  <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b94a6] block mb-1">Last Update Received</span>
                      <p className="text-sm font-bold text-white truncate">
                        {diagnostics.pipeline?.lastReceivedUpdate?.fileName || 'No updates yet'}
                      </p>
                      <p className="text-[11px] text-purple-300 truncate mt-0.5">
                        {diagnostics.pipeline?.lastReceivedUpdate?.source?.channelTitle || 'No channel post'}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-[#8b94a6]">
                      {diagnostics.pipeline?.lastReceivedUpdate?.createdAt
                        ? new Date(diagnostics.pipeline.lastReceivedUpdate.createdAt).toLocaleString()
                        : 'Awaiting webhook'}
                    </div>
                  </div>

                  {/* Last Successful Import */}
                  <div className="rounded-2xl border border-white/10 bg-[#121620] p-4 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">Last Successful Import</span>
                      <p className="text-sm font-bold text-white truncate">
                        {diagnostics.pipeline?.lastSuccessfulImport?.movie?.title || 'None'}
                      </p>
                      <p className="text-[11px] text-emerald-300 font-semibold mt-0.5">
                        {diagnostics.pipeline?.lastSuccessfulImport?.parsedQuality || 'N/A'} Variant Ready
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-[#8b94a6]">
                      {diagnostics.pipeline?.lastSuccessfulImport?.updatedAt
                        ? new Date(diagnostics.pipeline.lastSuccessfulImport.updatedAt).toLocaleString()
                        : 'No imports published'}
                    </div>
                  </div>
                </div>

                {/* Dual Delivery Strategy & Button Visibility Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Delivery Readiness */}
                  <div className="rounded-3xl border border-white/10 bg-[#121620] p-5 space-y-3">
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <Zap className="w-4 h-4 text-emerald-400" />
                      <span>Download Delivery Readiness</span>
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-start justify-between">
                        <div>
                          <p className="font-bold text-white">MODE A — Telegram Redirect</p>
                          <p className="text-[#8b94a6] text-[11px] mt-0.5">
                            {diagnostics.deliveryReadiness?.modeA_telegramRedirect?.reason || 'Zero VPS bandwidth. Direct t.me message link.'}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${diagnostics.deliveryReadiness?.modeA_telegramRedirect?.ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-[#8b94a6]'}`}>
                          {diagnostics.deliveryReadiness?.modeA_telegramRedirect?.ready ? 'ACTIVE' : 'STANDBY'}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-start justify-between">
                        <div>
                          <p className="font-bold text-white">MODE B — Website Direct Streaming</p>
                          <p className="text-[#8b94a6] text-[11px] mt-0.5">
                            {diagnostics.deliveryReadiness?.modeB_websiteDirectStream?.reason || 'Authenticated streaming with RFC 7233 Range requests. Zero persistent disk storage.'}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${diagnostics.deliveryReadiness?.modeB_websiteDirectStream?.ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-[#8b94a6]'}`}>
                          {diagnostics.deliveryReadiness?.modeB_websiteDirectStream?.ready ? 'ACTIVE' : 'STANDBY'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Button Visibility Diagnostics Policy */}
                  <div className="rounded-3xl border border-white/10 bg-[#121620] p-5 space-y-3">
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-purple-400" />
                      <span>Download Button Visibility Policy</span>
                    </h3>
                    <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200 space-y-1.5">
                      <div className="flex items-center space-x-2 font-bold text-white">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <span>Direct Download buttons rendered unconditionally</span>
                      </div>
                      <p className="text-[11px] text-[#8b94a6]">
                        Existing valid movie links (cloud DDLs, WebTorrent, direct stream) are always displayed immediately.
                        Telegram sync is decoupled and never blocks or hides existing links.
                      </p>
                      <div className="flex items-center space-x-2 font-bold text-white pt-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <span>Processing placeholder eliminated</span>
                      </div>
                      <p className="text-[11px] text-[#8b94a6]">
                        Independent Telegram variants (480p, 720p, 1080p, 4K) appear dynamically as soon as imported.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quality Variants Breakdown */}
                <div className="rounded-3xl border border-white/10 bg-[#121620] p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-purple-400" />
                      <span>Available Video Quality Variants</span>
                    </h3>
                    <span className="text-xs text-[#8b94a6]">
                      {Object.values(diagnostics.variants?.counts || {}).reduce((a, b) => a + b, 0)} Total Variants
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-center">
                      <span className="text-xs font-bold text-emerald-400">480p SD</span>
                      <p className="text-2xl font-black text-white mt-1">{diagnostics.variants?.counts?.['480p'] || 0}</p>
                    </div>
                    <div className="p-3.5 rounded-xl border border-sky-500/20 bg-sky-500/5 text-center">
                      <span className="text-xs font-bold text-sky-400">720p HD</span>
                      <p className="text-2xl font-black text-white mt-1">{diagnostics.variants?.counts?.['720p'] || 0}</p>
                    </div>
                    <div className="p-3.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 text-center">
                      <span className="text-xs font-bold text-indigo-400">1080p Full HD</span>
                      <p className="text-2xl font-black text-white mt-1">{diagnostics.variants?.counts?.['1080p'] || 0}</p>
                    </div>
                    <div className="p-3.5 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 text-center">
                      <span className="text-xs font-bold text-fuchsia-400">4K Ultra HD</span>
                      <p className="text-2xl font-black text-white mt-1">{diagnostics.variants?.counts?.['4K'] || diagnostics.variants?.counts?.['2160p'] || 0}</p>
                    </div>
                  </div>
                </div>

                {/* Failed Imports Section with Safe Retry Mechanism */}
                <div className="rounded-3xl border border-white/10 bg-[#121620] p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center space-x-2">
                        <XCircle className="w-4 h-4 text-rose-400" />
                        <span>Failed Imports & Errors ({diagnostics.pipeline?.failedCount || 0})</span>
                      </h3>
                      <p className="text-xs text-[#8b94a6] mt-0.5">
                        Import jobs that encountered resolution detection, network, or format errors. You can safely retry them.
                      </p>
                    </div>
                  </div>

                  {!diagnostics.pipeline?.failedList || diagnostics.pipeline.failedList.length === 0 ? (
                    <div className="p-6 rounded-2xl bg-black/20 border border-white/5 text-center text-xs text-[#8b94a6]">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-60" />
                      No failed imports recorded. The pipeline is running cleanly.
                    </div>
                  ) : (
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-white/10 text-[#8b94a6] uppercase text-[10px]">
                            <th className="pb-3 font-bold">File / Movie</th>
                            <th className="pb-3 font-bold">Channel</th>
                            <th className="pb-3 font-bold">Error Diagnostic Details</th>
                            <th className="pb-3 font-bold">Retries</th>
                            <th className="pb-3 font-bold text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {diagnostics.pipeline.failedList.map((job) => (
                            <tr key={job.id} className="hover:bg-white/[0.02]">
                              <td className="py-3 font-medium text-white max-w-xs truncate">
                                {job.fileName || job.parsedTitle || job.fileId}
                              </td>
                              <td className="py-3 text-[#8b94a6]">
                                {job.source?.channelTitle || job.sourceChannelId}
                              </td>
                              <td className="py-3 text-rose-300 font-mono text-[11px] max-w-md truncate">
                                {job.errorMessage || 'Unknown import error'}
                              </td>
                              <td className="py-3 text-[#8b94a6]">
                                {job.retryCount || 0}
                              </td>
                              <td className="py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRetryImport(job.id)}
                                  disabled={actionLoading}
                                  className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ml-auto"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  <span>Retry</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Recent Verified Movie Variants */}
                {diagnostics.variants?.recent && diagnostics.variants.recent.length > 0 && (
                  <div className="rounded-3xl border border-white/10 bg-[#121620] p-5 sm:p-6 space-y-4">
                    <h3 className="text-base font-bold text-white flex items-center space-x-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Recently Verified Movie Variants</span>
                    </h3>
                    <div className="overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-white/10 text-[#8b94a6] uppercase text-[10px]">
                            <th className="pb-3 font-bold">Movie Title</th>
                            <th className="pb-3 font-bold">Quality</th>
                            <th className="pb-3 font-bold">File Size</th>
                            <th className="pb-3 font-bold">Codec / Resolution</th>
                            <th className="pb-3 font-bold">Status</th>
                            <th className="pb-3 font-bold text-right">Added</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {diagnostics.variants.recent.map((v) => (
                            <tr key={v.id} className="hover:bg-white/[0.02]">
                              <td className="py-3 font-semibold text-white">
                                {v.movie?.title || 'Unknown Title'}
                              </td>
                              <td className="py-3">
                                <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-white/10 text-white">
                                  {v.quality}
                                </span>
                              </td>
                              <td className="py-3 text-[#8b94a6]">
                                {v.fileSizeFormatted || 'N/A'}
                              </td>
                              <td className="py-3 text-[#8b94a6]">
                                {v.codec || 'H.264'} {v.width && v.height ? `(${v.width}x${v.height})` : ''}
                              </td>
                              <td className="py-3">
                                {v.verifiedResolution ? (
                                  <span className="inline-flex items-center text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                    <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> FFprobe Verified
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center text-[10px] text-[#8b94a6] bg-white/5 px-2 py-0.5 rounded-full">
                                    Parsed
                                  </span>
                                )}
                              </td>
                              <td className="py-3 text-right text-[#8b94a6]">
                                {new Date(v.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Modal: Authorize New Channel */}
      {showAddChannel && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#141822] p-6 sm:p-8 space-y-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h3 className="text-xl font-bold text-white">Authorize Telegram Channel</h3>
              <button
                onClick={() => setShowAddChannel(false)}
                className="text-[#8b94a6] hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddChannel} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  Channel ID (e.g. -1001234567890 or @username) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="-1001234567890"
                  value={newChannel.channelId}
                  onChange={(e) => setNewChannel({ ...newChannel, channelId: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  Channel Title (Optional - auto-detected)
                </label>
                <input
                  type="text"
                  placeholder="Official Movie Releases Channel"
                  value={newChannel.channelTitle}
                  onChange={(e) => setNewChannel({ ...newChannel, channelTitle: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center space-x-2 text-xs text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newChannel.autoImport}
                    onChange={(e) => setNewChannel({ ...newChannel, autoImport: e.target.checked })}
                    className="rounded border-white/20 bg-black/40 text-purple-600 focus:ring-0"
                  />
                  <span>Enable Auto-Import</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newChannel.autoPublish}
                    onChange={(e) => setNewChannel({ ...newChannel, autoPublish: e.target.checked })}
                    className="rounded border-white/20 bg-black/40 text-purple-600 focus:ring-0"
                  />
                  <span>Auto-Publish Immediately</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  Redistribution Rights Status
                </label>
                <select
                  value={newChannel.rightsStatus}
                  onChange={(e) => setNewChannel({ ...newChannel, rightsStatus: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                >
                  <option value="verified">Verified (Approved for distribution)</option>
                  <option value="pending">Pending Verification</option>
                  <option value="revoked">Revoked</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#8b94a6] mb-1">
                  License / Rights Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="e.g. Authorized distributor agreement #2026-TG"
                  value={newChannel.licenseNotes}
                  onChange={(e) => setNewChannel({ ...newChannel, licenseNotes: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-white/10 bg-black/40 text-white focus:outline-none focus:border-purple-500 text-xs"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddChannel(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/10 text-[#8b94a6] hover:text-white font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center space-x-2"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  <span>Save Channel</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
