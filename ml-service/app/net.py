import torch
import torch.nn as nn
import torch.nn.functional as F
from .features import F_SEQ, F_STAT, N_H


class Net(nn.Module):
    """LSTM encoder + upcoming-event features -> (lower, median, upper) per horizon.
    Predicts a delta from the last observed utilisation; quantiles can't cross."""

    def __init__(self, hidden: int = 32):
        super().__init__()
        self.lstm = nn.LSTM(F_SEQ, hidden, num_layers=2, batch_first=True, dropout=0.1)
        self.head = nn.Sequential(nn.Linear(hidden + F_STAT, 64), nn.ReLU(), nn.Dropout(0.2),
                                  nn.Linear(64, N_H * 3))

    def forward(self, seq, stat):
        o, _ = self.lstm(seq)
        z = self.head(torch.cat([o[:, -1], stat], 1)).view(-1, N_H, 3)
        med = seq[:, -1, 0].view(-1, 1) + z[..., 0]
        return torch.stack([med - F.softplus(z[..., 1]), med, med + F.softplus(z[..., 2])], -1)