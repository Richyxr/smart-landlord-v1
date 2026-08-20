import React from 'react';
import { Building2, Home, Wallet, AlertTriangle, PlusCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card.jsx';
import { Badge } from './ui/badge.jsx';

export default function KPISummaryGrid({
  stats,
  formatCurrency,
  getMetricValue,
  onOpenAddProperty,
  onOpenOccupancy,
  onOpenBilling,
  onOpenArrears
}) {
  const propertiesCount = stats?.propertiesCount || 0;
  const unitsCount = stats?.unitsCount || 0;
  const occupiedCount = stats?.occupiedCount || 0;
  const collectedRent = stats?.collectedRent || 0;
  const arrears = stats?.arrears || 0;

  const occupancyRate = unitsCount > 0 ? Math.round((occupiedCount / unitsCount) * 100) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 w-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', width: '100%' }}>
      {/* 1. TOTAL PROPERTIES CARD */}
      {propertiesCount === 0 ? (
        <Card
          onClick={onOpenAddProperty}
          className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:border-purple-500/50 cursor-pointer"
        >
          <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
            <CardTitle className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              TOTAL PROPERTIES
            </CardTitle>
            <div className="size-9 rounded-xl flex items-center justify-center shrink-0 border border-purple-500/30 bg-purple-950/50 text-purple-400">
              <Building2 className="size-4.5" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-2 text-purple-400 font-semibold text-sm mt-1">
              <PlusCircle className="size-4.5" />
              <span>Register First Property</span>
              <ArrowRight className="size-4 transition-transform duration-200" />
            </div>
            <div className="flex items-center justify-between w-full gap-1.5 mt-2">
              <span className="text-xs text-slate-400 truncate">Start adding buildings</span>
              <Badge variant="outline">Portfolio</Badge>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card
          onClick={onOpenAddProperty}
          className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:border-purple-500/50 cursor-pointer"
        >
          <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
            <CardTitle className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              TOTAL PROPERTIES
            </CardTitle>
            <div className="size-9 rounded-xl flex items-center justify-center shrink-0 border border-purple-500/30 bg-purple-950/50 text-purple-400">
              <Building2 className="size-4.5" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="text-2xl font-extrabold text-slate-50 my-1 font-title">
              {getMetricValue('properties')}
            </div>
            <div className="flex items-center justify-between w-full gap-1.5 mt-2">
              <span className="text-xs text-slate-400 truncate">Registered buildings</span>
              <Badge variant="outline">Portfolio</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. OCCUPANCY CARD */}
      <Card
        onClick={onOpenOccupancy}
        className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:border-sky-500/50 cursor-pointer"
      >
        <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
          <CardTitle className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            OCCUPANCY
          </CardTitle>
          <div className="size-9 rounded-xl flex items-center justify-center shrink-0 border border-sky-500/30 bg-sky-950/50 text-sky-400">
            <Home className="size-4.5" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="text-2xl font-extrabold text-slate-50 my-1 font-title">
            {unitsCount === 0 ? "0 / 0 Units" : getMetricValue('occupancy')}
          </div>
          <div className="flex items-center justify-between w-full gap-1.5 mt-2">
            <span className="text-xs text-slate-400 truncate">
              {unitsCount === 0 ? "Assign tenants to units" : "Active units"}
            </span>
            <Badge variant={unitsCount > 0 ? "success" : "secondary"}>
              {unitsCount > 0 ? `${occupancyRate}% Rate` : "Registered"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 3. RENT COLLECTED CARD */}
      <Card
        onClick={onOpenBilling}
        className="p-5 bg-slate-900/90 border border-slate-800 rounded-2xl flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:border-emerald-500/50 cursor-pointer"
      >
        <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
          <CardTitle className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            RENT COLLECTED
          </CardTitle>
          <div className="size-9 rounded-xl flex items-center justify-center shrink-0 border border-emerald-500/30 bg-emerald-950/50 text-emerald-400">
            <Wallet className="size-4.5" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="text-2xl font-extrabold text-emerald-400 my-1 font-title">
            {collectedRent === 0 ? "Ksh 0" : getMetricValue('collected', formatCurrency)}
          </div>
          <div className="flex items-center justify-between w-full gap-1.5 mt-2">
            <span className="text-xs text-slate-400 truncate">
              {collectedRent === 0 ? "Awaiting statements" : "Current month"}
            </span>
            <Badge variant="success">Current Cycle</Badge>
          </div>
        </CardContent>
      </Card>

      {/* 4. ARREARS CARD */}
      <Card
        onClick={onOpenArrears}
        className={`p-5 bg-slate-900/90 border rounded-2xl flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 cursor-pointer ${
          arrears > 0
            ? 'bg-rose-950/20 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.12)] hover:border-rose-500/80'
            : 'border-slate-800 hover:border-purple-500/50'
        }`}
      >
        <CardHeader className="flex flex-row items-center justify-between p-0 pb-3">
          <CardTitle className={`text-[11px] font-semibold uppercase tracking-wider ${arrears > 0 ? 'text-rose-300' : 'text-slate-400'}`}>
            ARREARS
          </CardTitle>
          <div className={`size-9 rounded-xl flex items-center justify-center shrink-0 border ${
            arrears > 0
              ? 'border-rose-500/40 bg-rose-950/50 text-rose-500'
              : 'border-emerald-500/30 bg-emerald-950/50 text-emerald-400'
          }`}>
            {arrears > 0 ? (
              <AlertTriangle className="size-4.5" />
            ) : (
              <CheckCircle2 className="size-4.5" />
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className={`text-2xl font-extrabold my-1 font-title ${arrears > 0 ? 'text-rose-400' : 'text-slate-50'}`}>
            {getMetricValue('arrears', formatCurrency)}
          </div>
          <div className="flex items-center justify-between w-full gap-1.5 mt-2">
            <span className="text-xs text-slate-400 truncate">
              {arrears > 0 ? "Unpaid tenant balance" : "0 Unpaid Balance"}
            </span>
            <Badge variant={arrears > 0 ? "danger" : "success"}>
              {arrears > 0 ? "Action Required" : "Clean"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
