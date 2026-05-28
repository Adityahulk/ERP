import { Request, Response } from 'express';
import { success, error } from '../../../lib/response';
import * as service from './transaction-settings.service';

function firmId(req: Request) {
  return req.user!.company_id;
}

function handle(res: Response, fn: Promise<any>, emptyStatus = 200) {
  fn
    .then((data) => {
      if (data === null || data === false) return res.status(404).json(error('Record not found'));
      return res.status(emptyStatus).json(success(data));
    })
    .catch((err: any) => res.status(/invalid|required|must/i.test(err?.message || '') ? 400 : 500).json(error(err?.message || 'Transaction settings error')));
}

export function getAll(req: Request, res: Response) {
  handle(res, service.getSettingsForFirm(firmId(req)));
}

export function updateMain(req: Request, res: Response) {
  handle(res, service.updateSettings(firmId(req), req.body || {}));
}

export function getPrefixes(req: Request, res: Response) {
  handle(res, service.getPrefixes(firmId(req)));
}

export function updatePrefixes(req: Request, res: Response) {
  handle(res, service.updatePrefixes(firmId(req), req.body || {}));
}

export function getTerms(req: Request, res: Response) {
  handle(res, service.listTerms(firmId(req)));
}

export function createTerm(req: Request, res: Response) {
  handle(res, service.createTerm(firmId(req), req.body || {}), 201);
}

export function updateTerm(req: Request, res: Response) {
  handle(res, service.updateTerm(firmId(req), req.params.id, req.body || {}));
}

export function deleteTerm(req: Request, res: Response) {
  handle(res, service.deleteTerm(firmId(req), req.params.id));
}

export function getAdditionalFields(req: Request, res: Response) {
  handle(res, service.getAdditionalFields(firmId(req)));
}

export function updateAdditionalFields(req: Request, res: Response) {
  handle(res, service.updateAdditionalFields(firmId(req), req.body || {}));
}

export function getTransportation(req: Request, res: Response) {
  handle(res, service.getTransportation(firmId(req)));
}

export function updateTransportation(req: Request, res: Response) {
  handle(res, service.updateTransportation(firmId(req), req.body || {}));
}

export function getCharges(req: Request, res: Response) {
  handle(res, service.getCharges(firmId(req)));
}

export function updateCharges(req: Request, res: Response) {
  handle(res, service.updateCharges(firmId(req), req.body || {}));
}
