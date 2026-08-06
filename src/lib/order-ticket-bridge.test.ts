import { describe, expect, it } from 'vitest';
import { parseOrderTicketBridge } from './order-ticket-bridge';

describe('OrderTicket bridge', () => {
    it('只接受最小商品契約 schema', () => {
        expect(
            parseOrderTicketBridge(
                new URLSearchParams(
                    'popout=ticket&bridge=multiview&code=2330&security_type=STK&exchange=TSE',
                ),
            ),
        ).toEqual({ code: '2330', securityType: 'STK', exchange: 'TSE' });
    });

    it.each(['account', 'side', 'price', 'quantity', 'order_type', 'ca', 'token'])(
        '拒絕交易或秘密欄位 %s',
        (key) => {
            expect(
                parseOrderTicketBridge(
                    new URLSearchParams(
                        `popout=ticket&bridge=multiview&code=2330&security_type=STK&exchange=TSE&${key}=x`,
                    ),
                ),
            ).toBeNull();
        },
    );

    it.each(['IND', 'FUT', 'OPT'])('拒絕不支援的商品類型 %s', (type) => {
        expect(
            parseOrderTicketBridge(
                new URLSearchParams(
                    `popout=ticket&bridge=multiview&code=IX0001&security_type=${type}&exchange=TSE`,
                ),
            ),
        ).toBeNull();
    });
});
